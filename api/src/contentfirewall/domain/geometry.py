"""Coordinate arithmetic for detection — the pure half of the imaging work.

Boxes live in a normalized 1000x1000 space, which is why upscaling an image needs no
remapping at all: the numbers are resolution-independent. **Crops do.** A box the verifier
reports is relative to the crop, and mapping it back into the original frame is the one
place where getting the arithmetic subtly wrong moves a blur off the thing it was covering.

Kept separate from the pyvips adapter so all of it is testable without an image library,
and so the rounding rules stay visible instead of buried in a resize call.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final

from contentfirewall.domain.jsc import js_round

NORMALIZED: Final = 1000
"""A 168x94 thumbnail carries almost no signal for a detector; this is the floor."""
DETECTION_MIN_EDGE: Final = 768
"""Ceiling on an upscale, so a 16px icon cannot be blown up into a huge payload."""
MAX_UPSCALED_EDGE: Final = 1_536
"""Context kept around a crop so the verifier can see whether the box cut the object short."""
CROP_PADDING: Final = 0.12


@dataclass(frozen=True, slots=True)
class NormalizedBox:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True, slots=True)
class PixelRect:
    left: int
    top: int
    width: int
    height: int


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def padded_region(box: NormalizedBox, padding: float = CROP_PADDING) -> NormalizedBox | None:
    """The slice to cut, padded by a share of the box's own size and clamped to the frame.

    Padding is relative to the box rather than the image on purpose: the verifier needs to
    see whether the box cut the object short, and a fixed margin would be most of a small
    crop and invisible around a large one. ``None`` when nothing is left to cut.
    """
    pad_x = box.width * padding
    pad_y = box.height * padding
    left = clamp(box.x - pad_x, 0, NORMALIZED)
    top = clamp(box.y - pad_y, 0, NORMALIZED)
    right = clamp(box.x + box.width + pad_x, 0, NORMALIZED)
    bottom = clamp(box.y + box.height + pad_y, 0, NORMALIZED)
    if right - left <= 0 or bottom - top <= 0:
        return None
    return NormalizedBox(x=left, y=top, width=right - left, height=bottom - top)


def region_to_pixels(region: NormalizedBox, image_width: int, image_height: int) -> PixelRect:
    """Normalized region to an actual pixel rectangle that fits inside the image.

    Origin floors and extent rounds — matching the TypeScript original, including its use
    of JavaScript's round-half-up rather than Python's round-half-to-even. The extent is
    then clamped so the rectangle cannot run past the edge, which is what a naive
    conversion does on a box that touched the boundary.
    """
    left = math.floor((region.x / NORMALIZED) * image_width)
    top = math.floor((region.y / NORMALIZED) * image_height)
    width = max(1, js_round((region.width / NORMALIZED) * image_width))
    height = max(1, js_round((region.height / NORMALIZED) * image_height))
    return PixelRect(
        left=left,
        top=top,
        width=min(width, image_width - left),
        height=min(height, image_height - top),
    )


def box_from_crop(region: NormalizedBox, box_in_crop: NormalizedBox) -> NormalizedBox:
    """Map a box found inside a crop back into the original frame's coordinates.

    Without this every verified box would be reported against the wrong frame — and the
    blur would land somewhere else entirely, which looks like a detection bug rather than
    an arithmetic one.
    """
    scale_x = region.width / NORMALIZED
    scale_y = region.height / NORMALIZED
    x = clamp(region.x + box_in_crop.x * scale_x, 0, NORMALIZED)
    y = clamp(region.y + box_in_crop.y * scale_y, 0, NORMALIZED)
    return NormalizedBox(
        x=x,
        y=y,
        width=clamp(box_in_crop.width * scale_x, 1, NORMALIZED - x),
        height=clamp(box_in_crop.height * scale_y, 1, NORMALIZED - y),
    )


def upscale_target(width: int, height: int, min_edge: int = DETECTION_MIN_EDGE) -> tuple[int, int] | None:
    """Target size for a small image, or ``None`` when it is already big enough.

    Bounds the *result*, not the factor. Capping the factor at 4 left a 168px thumbnail at
    672px — short of the very floor the upscale exists to reach.
    """
    longest = max(width, height)
    if longest >= min_edge:
        return None
    factor = min(min_edge / longest, MAX_UPSCALED_EDGE / longest)
    return js_round(width * factor), js_round(height * factor)


def bound_target(width: int, height: int, max_edge: int = MAX_UPSCALED_EDGE) -> tuple[int, int] | None:
    """Target size for an oversized image, or ``None`` when it already fits.

    Detection gains nothing from a 4000px photo, and every extra pixel is base64 in a
    prompt — this is what keeps inlining the pixels affordable.
    """
    longest = max(width, height)
    if longest <= max_edge:
        return None
    factor = max_edge / longest
    return js_round(width * factor), js_round(height * factor)
