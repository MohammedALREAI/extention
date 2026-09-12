"""Detection orchestration: how many looks an image earns, and when to stop.

The governing idea is not "make the model work harder on every image" but "be smarter
about which images deserve a second look". An easy image costs one model call; an
uncertain one costs two; a small image that came back empty can cost three. Nothing costs
one call per box — that was the pattern that made a page of results unaffordable.

Every extra pass is gated on the deadline *before it starts*. A pass that gets cut off
mid-flight has spent the money and produced nothing, while skipping it leaves the pass-1
answer intact. A merely-good answer inside the budget beats a better one after the client
has already given up.
"""

from __future__ import annotations

import asyncio
import base64
import re
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Final

from contentfirewall.domain.deadline import Deadline
from contentfirewall.domain.errors import ModelReplyError
from contentfirewall.domain.geometry import (
    DETECTION_MIN_EDGE,
    NormalizedBox,
    bound_target,
    padded_region,
    region_to_pixels,
    upscale_target,
)
from contentfirewall.domain.models import (
    FirewallRule,
    PipelineImage,
    VisualBox,
    VisualDetection,
)
from contentfirewall.domain.ports import ImageFetcher, ImageOps, ModelCall, ModelGateway, ModelImage
from contentfirewall.domain.visual_localization import (
    MAX_BOXES_PER_IMAGE,
    build_visual_prompt,
    parse_visual_reply,
)
from contentfirewall.domain.visual_verify import (
    MAX_VERIFY_CROPS,
    VerifyCandidate,
    apply_verdicts,
    build_verify_prompt,
    crop_id_for,
    parse_verify_reply,
)

VISUAL_ROUTE: Final = "visual"
LOCALIZE_MAX_TOKENS: Final = 3_000
VERIFY_MAX_TOKENS: Final = 1_500

# A pass-1 result earns a second look when any of these holds. Stated explicitly rather
# than left to judgement, so the cost of verification is predictable and tunable.
VERIFY_CONFIDENCE_BELOW: Final = 0.8
VERIFY_AREA_RATIO_BELOW: Final = 0.05
VERIFY_OVERLAP_COUNT: Final = 3

NORMALIZED_AREA: Final = 1_000_000
EDGE_THRESHOLD: Final = 5

_DATA_URL: Final = re.compile(r"^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$", re.IGNORECASE)

Effort = str  # "fast" | "thorough"
FAST: Final = "fast"
THOROUGH: Final = "thorough"


@dataclass(frozen=True, slots=True)
class PipelineRequest:
    source_preference: str
    rules: Sequence[FirewallRule]
    images: Sequence[PipelineImage]
    effort: Effort = FAST
    describe_subject: bool = False


def needs_verification(boxes: Sequence[VisualBox]) -> bool:
    """Whether a pass-1 result is uncertain enough to be worth a second, cropped look."""
    if not boxes:
        return False
    if len(boxes) >= VERIFY_OVERLAP_COUNT:
        return True
    return any(
        box.confidence < VERIFY_CONFIDENCE_BELOW
        or box.area / NORMALIZED_AREA < VERIFY_AREA_RATIO_BELOW
        or box.x <= EDGE_THRESHOLD
        or box.y <= EDGE_THRESHOLD
        or box.right >= 1000 - EDGE_THRESHOLD
        or box.bottom >= 1000 - EDGE_THRESHOLD
        for box in boxes
    )


def decode_data_url(url: str) -> bytes | None:
    match = _DATA_URL.match(url.strip())
    if not match:
        return None
    compact = re.sub(r"\s+", "", match.group(2))
    try:
        return base64.b64decode(compact + "=" * (-len(compact) % 4), validate=False)
    except (ValueError, TypeError):
        return None


async def load_pixels(url: str, fetcher: ImageFetcher) -> bytes | None:
    """Get the actual bytes for an image. Inline data URLs already carry them."""
    inline = decode_data_url(url)
    if inline is not None:
        return inline
    fetched = await fetcher.fetch(url)
    return fetched.data if fetched else None


async def prepare_image(image: PipelineImage, data: bytes | None, ops: ImageOps) -> PipelineImage:
    """Turn an image into what the model actually looks at.

    Inlining matters more than the resizing. Handing over a URL makes the model provider
    fetch it from its own network, with no cookies, no referer and no page context, and a
    host that refuses that fetch — hotlink protection, a User-Agent check, a geo block —
    failed the whole call. On screen that was indistinguishable from "no match": the image
    stayed visible with nothing to say why.

    Boxes are normalized to 0-1000, so none of the resizing needs coordinate remapping.
    """
    if data is None:
        return image
    info = await ops.info(data)
    if info is None:
        return image  # undecodable: leave the URL and let the provider try, as before

    prepared = data
    target = upscale_target(info.width, info.height) or bound_target(info.width, info.height)
    if target is not None:
        resized = await ops.resize(prepared, *target)
        if resized is not None:
            prepared = resized

    encoded = await ops.to_jpeg(prepared)
    if encoded is None:
        return image
    return replace(image, url=f"data:image/jpeg;base64,{base64.b64encode(encoded).decode('ascii')}")


async def _localize(
    request: PipelineRequest,
    images: Sequence[PipelineImage],
    model: ModelGateway,
    deadline: Deadline,
) -> tuple[VisualDetection, ...]:
    prompt = build_visual_prompt(
        source_preference=request.source_preference,
        rules=request.rules,
        images=images,
        describe_subject=request.describe_subject,
    )
    answer = await model.invoke(
        ModelCall(
            route=VISUAL_ROUTE,
            prompt=prompt,
            images=[ModelImage(url=image.url) for image in images],
            max_tokens=LOCALIZE_MAX_TOKENS,
            # Parsed inside the ladder, so a model that answers with unusable content is
            # treated as a failed model and the next one is tried.
            parse=parse_visual_reply,
        ),
        timeout=deadline.remaining(),
    )
    return answer.value if answer.value is not None else parse_visual_reply(answer.content)


async def build_verify_candidates(
    images: Sequence[tuple[str, bytes, Sequence[VisualBox]]],
    ops: ImageOps,
    limit: int = MAX_VERIFY_CROPS,
) -> list[VerifyCandidate]:
    """Cut a padded crop per candidate box, up to the batch limit.

    The limit is across *all* images, not per image: the batch is what keeps a second look
    affordable, and an unbounded one would cost more than the detection it is checking.
    """
    candidates: list[VerifyCandidate] = []
    for image_id, data, boxes in images:
        info = await ops.info(data)
        if info is None:
            continue
        for index, box in enumerate(boxes):
            if len(candidates) >= limit:
                return candidates
            region = padded_region(NormalizedBox(box.x, box.y, box.width, box.height))
            if region is None:
                continue
            cropped = await ops.crop(data, region_to_pixels(region, info.width, info.height))
            if cropped is None:
                continue
            # Crops are small by definition, so they are raised to the detection floor
            # before the verifier sees them.
            crop_info = await ops.info(cropped)
            if crop_info is not None:
                target = upscale_target(crop_info.width, crop_info.height)
                if target is not None:
                    resized = await ops.resize(cropped, *target)
                    if resized is not None:
                        cropped = resized
            encoded = await ops.to_jpeg(cropped)
            if encoded is None:
                continue
            candidates.append(
                VerifyCandidate(
                    crop_id=crop_id_for(image_id, index),
                    image_id=image_id,
                    label=box.label,
                    box=box,
                    data=encoded,
                    region=region,
                )
            )
    return candidates


async def _verify(
    candidates: Sequence[VerifyCandidate],
    model: ModelGateway,
    deadline: Deadline,
):
    """One batched call for every crop — never one call per box."""
    crop_ids = [candidate.crop_id for candidate in candidates]
    answer = await model.invoke(
        ModelCall(
            route=VISUAL_ROUTE,
            prompt=build_verify_prompt(candidates),
            images=[
                ModelImage(url=f"data:image/jpeg;base64,{base64.b64encode(c.data).decode('ascii')}")
                for c in candidates
            ],
            max_tokens=VERIFY_MAX_TOKENS,
            parse=lambda content: parse_verify_reply(content, crop_ids),
        ),
        timeout=deadline.remaining(),
    )
    return answer.value if answer.value is not None else parse_verify_reply(answer.content, crop_ids)


async def detect_images(
    request: PipelineRequest,
    *,
    model: ModelGateway,
    fetcher: ImageFetcher,
    ops: ImageOps,
    deadline: Deadline,
) -> tuple[VisualDetection, ...]:
    """Run detection with as many looks as the result and the clock justify.

    ``fast`` is exactly the single call the extension has always made, kept both as a
    fallback and so an A/B measurement has something to compare against.
    ``thorough`` inlines and resizes the pixels, then verifies uncertain results, then
    retries once on a small image that came back empty. Easy images still cost one call.
    """
    if request.effort == FAST:
        return await _localize(request, request.images, model, deadline)

    pixels: dict[str, bytes | None] = dict(
        zip(
            [image.id for image in request.images],
            await asyncio.gather(*(load_pixels(image.url, fetcher) for image in request.images)),
            strict=True,
        )
    )
    prepared = list(
        await asyncio.gather(
            *(prepare_image(image, pixels[image.id], ops) for image in request.images)
        )
    )

    detections = await _localize(request, prepared, model, deadline)

    detections = await _retry_empty_small_images(
        request, prepared, detections, pixels, model, ops, deadline
    )
    return await _verify_uncertain(detections, pixels, model, ops, deadline)


async def _retry_empty_small_images(
    request: PipelineRequest,
    prepared: Sequence[PipelineImage],
    detections: tuple[VisualDetection, ...],
    pixels: dict[str, bytes | None],
    model: ModelGateway,
    ops: ImageOps,
    deadline: Deadline,
) -> tuple[VisualDetection, ...]:
    """One more look at a small image that found nothing — the case most often wrong.

    This is the third call and it is reserved: only a *small* image, only when pass 1 was
    empty, and only with enough budget left. A large image that legitimately contains
    nothing is not retried.
    """
    retry_ids: set[str] = set()
    for detection in detections:
        if detection.unavailable or detection.boxes:
            continue
        data = pixels.get(detection.id)
        if data is None:
            continue
        info = await ops.info(data)
        if info is not None and max(info.width, info.height) < DETECTION_MIN_EDGE:
            retry_ids.add(detection.id)

    if not retry_ids or not deadline.can_afford():
        return detections

    try:
        retried = await _localize(
            request, [image for image in prepared if image.id in retry_ids], model, deadline
        )
    except (ModelReplyError, TimeoutError):
        return detections  # a failed retry leaves the original empty result untouched

    by_id = {detection.id: detection for detection in retried}
    return tuple(by_id.get(detection.id, detection) for detection in detections)


async def _verify_uncertain(
    detections: tuple[VisualDetection, ...],
    pixels: dict[str, bytes | None],
    model: ModelGateway,
    ops: ImageOps,
    deadline: Deadline,
) -> tuple[VisualDetection, ...]:
    """Confirm or drop the boxes that pass 1 was not confident about.

    Any failure returns pass 1 unchanged. Verification is an improvement, never a
    dependency — a broken second look must not be worse than not looking twice.
    """
    uncertain = [
        detection
        for detection in detections
        if not detection.unavailable and needs_verification(detection.boxes)
    ]
    if not uncertain or not deadline.can_afford():
        return detections

    try:
        sources = [
            (detection.id, data, detection.boxes)
            for detection in uncertain
            if (data := pixels.get(detection.id)) is not None
        ]
        candidates = await build_verify_candidates(sources, ops)
        if not candidates:
            return detections
        verdicts = await _verify(candidates, model, deadline)
    except (ModelReplyError, TimeoutError, OSError):
        return detections

    uncertain_ids = {detection.id for detection in uncertain}
    return tuple(
        replace(
            detection,
            boxes=apply_verdicts(detection.boxes, detection.id, candidates, verdicts)[
                :MAX_BOXES_PER_IMAGE
            ],
        )
        if detection.id in uncertain_ids
        else detection
        for detection in detections
    )
