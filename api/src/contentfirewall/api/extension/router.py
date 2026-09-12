"""The two frozen extension endpoints.

Everything about the wire shape here is inherited and must not drift: a **bare top-level
JSON array** on success, ids echoed exactly as sent, ``status: "unavailable"`` reserved for
"could not inspect", and status codes the client maps to distinct user-visible outcomes —
401 policy_access, 402 access_ended, 429 rate_limited, 400 terminal, anything else retried
exactly once.

The server budget is 15 seconds because the installed extension aborts at 20. An answer
after that is one nobody reads.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any, Final

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from contentfirewall.api.extension.cors import cors_headers, is_allowed_origin
from contentfirewall.api.extension.normalize import normalize_images, normalize_results
from contentfirewall.domain.deadline import Deadline
from contentfirewall.domain.models import FirewallRule, PipelineImage
from contentfirewall.domain.ports import ModelCall
from contentfirewall.domain.semantic import (
    ResultCard,
    bounded_ids,
    build_semantic_prompt,
    parse_semantic_reply,
    restore_ids,
    semantic_response_schema,
)
from contentfirewall.domain.visual_pipeline import THOROUGH, PipelineRequest, detect_images

logger: Final = logging.getLogger(__name__)

router: Final = APIRouter(prefix="/api/extension", tags=["extension"])

EXTENSION_VISUAL_BUDGET_S: Final = 15.0
SEMANTIC_BUDGET_S: Final = 4.0
SEMANTIC_MAX_TOKENS: Final = 220


def _refuse_origin() -> JSONResponse:
    return JSONResponse({"error": "Extension origin required."}, status_code=403)


def _error(message: str, status: int, headers: dict[str, str]) -> JSONResponse:
    """The extension's error envelope: a flat string, not the SPA's structured one."""
    return JSONResponse({"error": message}, status_code=status, headers=headers)


def _preflight(request: Request) -> Response:
    origin = request.headers.get("origin")
    if not is_allowed_origin(origin):
        return _refuse_origin()
    headers = cors_headers(
        origin,
        wants_private_network=request.headers.get("access-control-request-private-network") == "true",
        allow_private_network=request.app.state.allow_private_network,
    )
    return Response(status_code=204, headers=headers)


@router.options("/visual-localize")
async def visual_preflight(request: Request) -> Response:
    return _preflight(request)


@router.options("/semantic-evaluate")
async def semantic_preflight(request: Request) -> Response:
    return _preflight(request)


async def _read_json(request: Request) -> Any:
    try:
        return await request.json()
    except (ValueError, UnicodeDecodeError):
        return None


@router.post("/visual-localize")
async def visual_localize(request: Request) -> Response:
    origin = request.headers.get("origin")
    if not is_allowed_origin(origin):
        return _refuse_origin()
    headers = cors_headers(origin)

    payload = await _read_json(request)
    images = normalize_images(payload)
    if not images:
        return _error("At least one HTTPS image URL or inline image is required.", 400, headers)

    policy = await request.app.state.resolve_policy(request, payload)
    if policy.error is not None:
        return _error(policy.error.message, policy.error.status, headers)

    try:
        detections = await detect_images(
            PipelineRequest(
                source_preference=policy.source_preference,
                rules=policy.rules,
                images=[
                    PipelineImage(
                        id=image.id, url=image.url, width=image.width, height=image.height, context=image.context
                    )
                    for image in images
                ],
                effort=THOROUGH,
            ),
            model=request.app.state.model,
            fetcher=request.app.state.fetcher,
            ops=request.app.state.ops,
            deadline=Deadline.after(EXTENSION_VISUAL_BUDGET_S),
        )
    except Exception:
        logger.exception("visual localization failed")
        return _error("Visual localization was unavailable.", 502, headers)

    answered = {detection.id for detection in detections}
    body = [
        {
            "id": detection.id,
            "boxes": [
                {
                    "x": box.x,
                    "y": box.y,
                    "width": box.width,
                    "height": box.height,
                    "label": box.label,
                    "confidence": box.confidence,
                }
                for box in detection.boxes
            ],
            **({"status": "unavailable"} if detection.unavailable else {}),
            **({"subject": detection.subject} if detection.subject else {}),
        }
        for detection in detections
    ]
    # One entry per supplied id, always. An id missing from the response is read by the
    # client as unavailable, which is correct but wasteful; saying so explicitly is cheaper
    # for it and keeps the contract's promise literally true.
    body.extend(
        {"id": image.id, "boxes": [], "status": "unavailable"}
        for image in images
        if image.id not in answered
    )
    return JSONResponse(body, headers=headers)


@router.post("/semantic-evaluate")
async def semantic_evaluate(request: Request) -> Response:
    origin = request.headers.get("origin")
    if not is_allowed_origin(origin):
        return _refuse_origin()
    headers = cors_headers(origin)

    payload = await _read_json(request)
    results = normalize_results(payload)
    if not results:
        return _error("At least one result text is required.", 400, headers)

    policy = await request.app.state.resolve_policy(request, payload)
    if policy.error is not None:
        return _error(policy.error.message, policy.error.status, headers)

    cards = [ResultCard(id=result.id, text=result.text) for result in results]
    surrogates, original_by_surrogate = bounded_ids(cards)

    try:
        answer = await request.app.state.model.invoke(
            _semantic_call(policy.source_preference, policy.rules, surrogates),
            timeout=SEMANTIC_BUDGET_S,
        )
        parsed = answer.value if answer.value is not None else parse_semantic_reply(answer.content)
        evaluations = restore_ids(parsed, original_by_surrogate)
    except Exception:
        logger.exception("semantic evaluation failed")
        return _error("Semantic evaluation was unavailable.", 502, headers)

    body = [
        {
            "id": evaluation.id,
            "decision": str(evaluation.decision),
            "confidence": evaluation.confidence,
            "reason": evaluation.reason,
            "matchedText": list(evaluation.matched_text),
            "source": "semantic",
        }
        for evaluation in evaluations
    ]
    return JSONResponse(body, headers=headers)


def _semantic_call(
    source_preference: str, rules: Sequence[FirewallRule], cards: Sequence[ResultCard]
) -> ModelCall:
    return ModelCall(
        route="semantic",
        prompt=build_semantic_prompt(source_preference=source_preference, rules=rules, results=cards),
        max_tokens=SEMANTIC_MAX_TOKENS,
        response_schema=semantic_response_schema(),
        system_prompt="Return only valid JSON matching the supplied schema.",
        # Inside the ladder: a model that ignores the schema and answers with empty content
        # has failed, and the next model should get the question.
        parse=parse_semantic_reply,
    )


__all__ = ["EXTENSION_VISUAL_BUDGET_S", "SEMANTIC_BUDGET_S", "router"]
