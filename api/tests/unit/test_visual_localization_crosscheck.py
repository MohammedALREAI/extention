"""Holds the Python parser to what the TypeScript parser actually produced.

163 replies — every threshold boundary, every coercion quirk, every reply framing — run
through ``server/visualLocalization.ts`` and recorded by
``api/scripts/capture_parser_golden.mjs``. This is the only artefact that proves the port
did not quietly change which boxes survive; the hand-written tests only prove the port
agrees with me.
"""

import json
import math
from pathlib import Path

import pytest

from contentfirewall.domain.errors import ModelReplyError
from contentfirewall.domain.models import VisualDetection
from contentfirewall.domain.visual_localization import parse_visual_reply

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "parser_golden.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def as_comparable(detections: tuple[VisualDetection, ...]) -> list[dict]:
    """Render Python detections in the shape the TypeScript parser returns.

    TS omits `subject` and `status` when absent rather than emitting null, and its numbers
    are all JS numbers. Normalising here keeps the comparison about behaviour rather than
    about serialization style.
    """
    rendered = []
    for detection in detections:
        entry: dict = {"id": detection.id, "boxes": []}
        for box in detection.boxes:
            fields = {
                "x": box.x,
                "y": box.y,
                "width": box.width,
                "height": box.height,
                "confidence": box.confidence,
                "label": box.label,
            }
            if box.mask is not None:
                fields["mask"] = box.mask
            entry["boxes"].append(fields)
        if detection.status is not None:
            entry["status"] = detection.status
        if detection.subject is not None:
            entry["subject"] = detection.subject
        rendered.append(entry)
    return rendered


def normalise(value):
    """Ints and floats compare equal across the two runtimes; JS has only one number type."""
    if isinstance(value, dict):
        return {key: normalise(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [normalise(item) for item in value]
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float) and math.isfinite(value):
        return float(value)
    return value


# Divergences we chose, each with the reason. Anything not listed here must match exactly.
# The point of naming them is that a *new* difference fails the suite instead of being
# absorbed into a vague tolerance.
DELIBERATE_DIVERGENCES = {
    "non-object box": (
        "The Node parser dereferenced every element of the boxes array and threw on the "
        "first non-object, failing the whole batch over one stray null. We skip the junk "
        "and keep the real boxes — while still refusing an array that is nothing but junk, "
        "so an uninterpretable answer cannot read as a confident no-match."
    ),
}


def divergence_for(name: str) -> str | None:
    base = name.rsplit(" [", 1)[0]
    return DELIBERATE_DIVERGENCES.get(base)


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_matches_the_typescript_parser(case: dict) -> None:
    divergence = divergence_for(case["name"])
    if divergence is not None:
        pytest.skip(divergence)  # pinned separately by test_deliberate_divergence_behaviour
    if case["error"] is not None:
        # The TS parser threw. The Python parser must also refuse, and must refuse in a way
        # that cannot be mistaken for "nothing matched" — that distinction is the whole
        # reason this error type exists.
        with pytest.raises(ModelReplyError):
            parse_visual_reply(case["input"])
        return

    actual = as_comparable(parse_visual_reply(case["input"]))
    assert normalise(actual) == normalise(case["output"]), case["name"]


def test_deliberate_divergence_behaviour() -> None:
    """The skipped cross-check cases, pinned to what we decided instead."""
    good = {"x": 100, "y": 100, "width": 300, "height": 300, "label": "dog", "confidence": 0.9}

    # A stray null alongside a real box: keep the box rather than failing the batch.
    mixed = json.dumps({"detections": [{"id": "a", "boxes": ["nope", 5, None, good]}]})
    (detection,) = parse_visual_reply(mixed)
    assert [b.label for b in detection.boxes] == ["dog"]

    # Nothing usable at all: refuse, because an empty box list reads as "clean" downstream.
    junk = json.dumps({"detections": [{"id": "a", "boxes": [None, "nope", 5]}]})
    with pytest.raises(ModelReplyError):
        parse_visual_reply(junk)

    # A genuinely empty array is still a legitimate no-match and must not raise.
    empty = json.dumps({"detections": [{"id": "a", "boxes": []}]})
    assert parse_visual_reply(empty)[0].boxes == ()


def test_the_corpus_covers_both_outcomes_and_is_not_trivial() -> None:
    # A corpus where everything parses, or everything is empty, would pass while proving
    # nothing about the filtering rules.
    assert len(CASES) >= 150
    assert any(case["error"] for case in CASES), "no case exercises the refusal path"
    assert any(case["output"] and case["output"][0]["boxes"] for case in CASES if case["output"])
    assert any(
        case["output"] and not case["output"][0]["boxes"] for case in CASES if case["output"]
    ), "no case exercises a box being filtered out"
