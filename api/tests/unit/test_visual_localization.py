"""Ported from server/visualLocalization.test.ts, plus the threshold locks.

Every acceptance and rejection below encodes a decision that was tuned against real
search pages. Loosening one is a product change, not a test fix.
"""

import json

import pytest

from contentfirewall.domain.errors import ModelReplyError
from contentfirewall.domain.models import FirewallRule, PipelineImage, PolicyAction, VisualBox
from contentfirewall.domain.visual_localization import (
    IOU_DUPLICATE,
    LARGE_AREA_RATIO,
    MAX_ASPECT_RATIO,
    MAX_BOXES_PER_IMAGE,
    MIN_EDGE_BOX_AREA_FLOOR,
    MIN_VISUAL_BOX_AREA,
    MIN_VISUAL_CONFIDENCE,
    MIN_VISUAL_CONFIDENCE_EDGE,
    MIN_VISUAL_CONFIDENCE_LARGE,
    SAME_LABEL_CONTAINMENT,
    build_visual_prompt,
    clean_json_text,
    confidence_threshold,
    containment_ratio,
    deduplicate_boxes,
    describe_image_for_prompt,
    is_edge_box,
    parse_visual_reply,
)


def reply(*detections: dict) -> str:
    return json.dumps({"detections": list(detections)})


def box(**overrides) -> dict:
    base = {"x": 100, "y": 100, "width": 300, "height": 300, "label": "dog", "confidence": 0.9}
    return base | overrides


class TestThresholdsAreLocked:
    """These numbers are the product. A change here must be deliberate and reviewed."""

    def test_every_threshold(self) -> None:
        assert MIN_VISUAL_CONFIDENCE == 0.62
        assert MIN_VISUAL_CONFIDENCE_EDGE == 0.55
        assert MIN_VISUAL_CONFIDENCE_LARGE == 0.75
        assert MIN_VISUAL_BOX_AREA == 1_200
        assert MIN_EDGE_BOX_AREA_FLOOR == 800
        assert LARGE_AREA_RATIO == 0.30
        assert MAX_ASPECT_RATIO == 12
        assert MAX_BOXES_PER_IMAGE == 8
        assert IOU_DUPLICATE == 0.55
        assert SAME_LABEL_CONTAINMENT == 0.75

    def test_size_is_judged_before_position(self) -> None:
        # The ordering bug this guards: a box covering most of the frame also touches
        # every boundary, so testing for an edge first handed the loosest threshold to
        # exactly the "the whole picture is a dog" claim the strict floor exists to stop.
        whole_frame = VisualBox(x=0, y=0, width=1000, height=1000, label="dog", confidence=0.70)
        assert is_edge_box(whole_frame) is True
        assert confidence_threshold(whole_frame) == MIN_VISUAL_CONFIDENCE_LARGE
        assert parse_visual_reply(
            reply({"id": "whole", "boxes": [box(x=0, y=0, width=1000, height=1000, confidence=0.70)]})
        )[0].boxes == ()


class TestSelectiveDetection:
    def test_accepts_the_matched_object_in_a_mixed_image(self) -> None:
        detections = parse_visual_reply(
            reply({"id": "dog-cat", "boxes": [box(x=521, y=252, width=254, height=576, label="dog", confidence=0.97)]})
        )
        assert len(detections) == 1
        assert detections[0].id == "dog-cat"
        assert [b.label for b in detections[0].boxes] == ["dog"]

    def test_labels_may_be_in_any_script(self) -> None:
        detections = parse_visual_reply(
            reply({"id": "dog-cat", "boxes": [box(x=281, y=472, width=274, height=376, label="قطط", confidence=0.98)]})
        )
        (only,) = detections[0].boxes
        assert (only.label, only.x, only.y) == ("قطط", 281, 472)

    def test_returns_only_the_blocked_object_from_dog_cat_and_car(self) -> None:
        detections = parse_visual_reply(
            reply({"id": "dog-cat-car", "boxes": [box(x=60, y=300, width=240, height=320, confidence=0.91)]})
        )
        assert [b.label for b in detections[0].boxes] == ["dog"]

    def test_an_image_with_nothing_matching_stays_a_no_match(self) -> None:
        detections = parse_visual_reply(reply({"id": "dog-only", "boxes": []}))
        assert detections[0].boxes == ()
        assert detections[0].status is None


class TestRejection:
    def test_drops_low_confidence_and_tiny_boxes(self) -> None:
        detections = parse_visual_reply(
            reply({
                "id": "mixed",
                "boxes": [
                    box(x=20, y=20, width=400, height=400, label="uncertain cat", confidence=0.52),
                    box(x=100, y=100, width=20, height=40, label="speck", confidence=0.99),
                ],
            })
        )
        assert detections[0].boxes == ()

    def test_refuses_a_whole_image_box_at_a_confidence_a_small_object_passes(self) -> None:
        small = parse_visual_reply(
            reply({"id": "background", "boxes": [box(x=700, y=120, width=40, height=45, confidence=0.66)]})
        )
        whole = parse_visual_reply(
            reply({"id": "everything", "boxes": [box(x=5, y=5, width=980, height=980, confidence=0.66)]})
        )
        assert len(small[0].boxes) == 1  # a distant dog survives
        assert whole[0].boxes == ()  # the same confidence claiming the frame does not

    def test_rejects_an_elongated_sliver(self) -> None:
        detections = parse_visual_reply(
            reply({"id": "sliver", "boxes": [box(x=100, y=100, width=600, height=40, confidence=0.95)]})
        )
        assert detections[0].boxes == ()

    @pytest.mark.parametrize(
        "geometry",
        [
            {"x": -1},
            {"y": -5},
            {"width": 0},
            {"height": -10},
            {"x": 900, "width": 200},  # runs past the right edge
            {"y": 900, "height": 200},  # runs past the bottom
            {"confidence": "not a number"},
        ],
        ids=["neg-x", "neg-y", "zero-width", "neg-height", "overflow-x", "overflow-y", "nan-confidence"],
    )
    def test_rejects_impossible_geometry(self, geometry: dict) -> None:
        detections = parse_visual_reply(reply({"id": "bad", "boxes": [box(**geometry)]}))
        assert detections[0].boxes == ()

    def test_a_missing_coordinate_is_undefined_and_rejected(self) -> None:
        # Number(undefined) is NaN and fails the finiteness check...
        without_x = {k: v for k, v in box().items() if k != "x"}
        assert parse_visual_reply(reply({"id": "a", "boxes": [without_x]}))[0].boxes == ()
        # ...but Number(null) is 0, which is a valid coordinate. This asymmetry is
        # inherited from the Node parser and is why js_number exists.
        with_null_x = box(x=None)
        assert len(parse_visual_reply(reply({"id": "b", "boxes": [with_null_x]}))[0].boxes) == 1

    def test_caps_the_number_of_boxes_per_image(self) -> None:
        many = [box(x=i * 100, y=0, width=90, height=300, label=f"dog-{i}", confidence=0.9) for i in range(10)]
        detections = parse_visual_reply(reply({"id": "crowd", "boxes": many}))
        assert len(detections[0].boxes) <= MAX_BOXES_PER_IMAGE


class TestEdgeTolerance:
    def test_keeps_a_clipped_detection_the_same_confidence_fails_mid_image(self) -> None:
        clipped = box(x=0, y=400, width=60, height=200, label="cat", confidence=0.58)
        detections = parse_visual_reply(
            reply({"id": "clipped", "boxes": [clipped]}, {"id": "middle", "boxes": [clipped | {"x": 400}]})
        )
        assert [b.x for b in detections[0].boxes] == [0]
        assert detections[1].boxes == ()

    def test_accepts_a_small_edge_sliver_but_not_the_same_area_mid_image(self) -> None:
        detections = parse_visual_reply(
            reply({
                "id": "areas",
                "boxes": [
                    box(x=0, y=500, width=30, height=35, label="cat", confidence=0.7),
                    box(x=400, y=500, width=30, height=35, label="cat", confidence=0.99),
                ],
            })
        )
        assert [b.x for b in detections[0].boxes] == [0]

    def test_retains_a_partially_visible_target(self) -> None:
        detections = parse_visual_reply(
            reply({"id": "partial-cat", "boxes": [box(x=0, y=380, width=250, height=310, label="cat", confidence=0.89)]})
        )
        (only,) = detections[0].boxes
        assert (only.label, only.x, only.confidence) == ("cat", 0, 0.89)


class TestLargeBoxes:
    def test_demands_more_confidence_from_a_box_claiming_most_of_the_image(self) -> None:
        large = box(x=100, y=100, width=700, height=600, confidence=0.73)
        weak, strong = parse_visual_reply(
            reply({"id": "weak", "boxes": [large]}, {"id": "strong", "boxes": [large | {"confidence": 0.78}]})
        )
        assert weak.boxes == ()
        assert len(strong.boxes) == 1


class TestDeduplication:
    def test_keeps_distinct_instances_but_drops_overlapping_duplicates(self) -> None:
        detections = parse_visual_reply(
            reply({
                "id": "three-cats",
                "boxes": [
                    box(x=80, y=100, width=220, height=310, label="cat", confidence=0.96),
                    box(x=88, y=108, width=215, height=300, label="cat", confidence=0.84),
                    box(x=610, y=180, width=220, height=300, label="cat", confidence=0.93),
                ],
            })
        )
        assert [b.x for b in detections[0].boxes] == [80, 610]

    def test_same_label_containment_merges_but_a_different_label_does_not(self) -> None:
        outer = box(x=100, y=100, width=400, height=400, label="dog", confidence=0.95)
        inner = {"x": 150, "y": 150, "width": 200, "height": 200, "confidence": 0.8}
        same, other = parse_visual_reply(
            reply(
                {"id": "same-label", "boxes": [outer, inner | {"label": "dog"}]},
                # A cat sitting on a dog is a separate match, not a duplicate detection.
                {"id": "other-label", "boxes": [outer, inner | {"label": "cat"}]},
            )
        )
        assert [(b.label, b.width) for b in same.boxes] == [("dog", 400)]
        assert [b.label for b in other.boxes] == ["dog", "cat"]

    def test_containment_ratio_of_a_fully_enclosed_box_is_one(self) -> None:
        outer = VisualBox(x=100, y=100, width=400, height=400, label="dog", confidence=0.95)
        inner = VisualBox(x=150, y=150, width=200, height=200, label="dog", confidence=0.8)
        assert containment_ratio(outer, inner) == 1.0

    def test_is_idempotent_and_never_invents_a_box(self) -> None:
        boxes = tuple(
            VisualBox(x=x, y=0, width=200, height=300, label="dog", confidence=c)
            for x, c in ((0, 0.9), (10, 0.8), (500, 0.95))
        )
        once = deduplicate_boxes(boxes)
        assert deduplicate_boxes(once) == once
        assert set(once).issubset(set(boxes))


class TestUnavailable:
    def test_preserves_an_unavailable_status_rather_than_converting_it_to_a_no_match(self) -> None:
        # The extension caches unavailable for 10s and a no-match for 10 minutes. Conflate
        # them and an unchecked image stays visible for ten minutes.
        (detection,) = parse_visual_reply(reply({"id": "blocked", "status": "unavailable", "boxes": []}))
        assert detection.status == "unavailable"
        assert detection.unavailable is True
        assert detection.boxes == ()

    def test_unavailable_wins_even_when_boxes_were_supplied(self) -> None:
        (detection,) = parse_visual_reply(
            reply({"id": "odd", "status": "unavailable", "boxes": [box()]})
        )
        assert detection.boxes == ()


class TestReplyExtraction:
    def test_parses_a_markdown_fenced_reply(self) -> None:
        fenced = f"```json\n{reply({'id': 'fenced-dog', 'boxes': [box()]})}\n```"
        detections = parse_visual_reply(fenced)
        assert detections[0].id == "fenced-dog"
        assert len(detections[0].boxes) == 1

    def test_strips_conversational_prefix_and_suffix(self) -> None:
        raw = 'Here is the output:\n{"detections":[{"id":"test","boxes":[]}]}\nHope this helps!'
        assert clean_json_text(raw) == '{"detections":[{"id":"test","boxes":[]}]}'

    def test_accepts_content_supplied_as_a_list_of_parts(self) -> None:
        parts = [{"type": "text", "text": reply({"id": "parted", "boxes": []})}]
        assert parse_visual_reply(parts)[0].id == "parted"

    def test_an_unusable_reply_raises_rather_than_reading_as_no_match(self) -> None:
        # This is the distinction that matters: a broken answer must not become "clean".
        for bad in ("not json at all", '{"nope": []}', '{"detections": {}}'):
            with pytest.raises(ModelReplyError):
                parse_visual_reply(bad)

    def test_a_detection_without_an_id_raises(self) -> None:
        with pytest.raises(ModelReplyError):
            parse_visual_reply(reply({"boxes": []}))


class TestPrompt:
    def test_describes_each_image_with_its_dimensions_and_caption(self) -> None:
        assert (
            describe_image_for_prompt(PipelineImage(id="img-1", url="", width=275, height=183, context="Dog vs Cat"))
            == 'img-1 (275×183) — nearby page text: "Dog vs Cat"'
        )
        # An image with no caption must not gain an empty quoted field.
        assert describe_image_for_prompt(PipelineImage(id="img-2", url="", width=275, height=183)) == "img-2 (275×183)"
        assert describe_image_for_prompt(PipelineImage(id="img-3", url="")) == "img-3"

    def test_carries_the_thresholds_and_the_caption_rule(self) -> None:
        prompt = build_visual_prompt(
            source_preference="Do not show me: dog",
            rules=[FirewallRule(term="dog", action=PolicyAction.BLUR)],
            images=[PipelineImage(id="a", url="https://example.test/a.jpg", width=200, height=100)],
        )
        assert "PAGE TEXT IS A HINT, NEVER EVIDENCE" in prompt
        assert "DEPICTIONS COUNT" in prompt
        assert str(MIN_VISUAL_CONFIDENCE) in prompt and str(MIN_VISUAL_CONFIDENCE_LARGE) in prompt
        assert '{"term":"dog","action":"blur"}' in prompt
        assert "a (200×100)" in prompt
        # The output shape must not ask for a subject field unless it was requested.
        # (The word "subject" itself appears in the depictions clause, so match the field.)
        assert '"subject"' not in prompt

    def test_asks_for_a_subject_only_when_requested(self) -> None:
        kwargs = {
            "source_preference": "no dogs",
            "rules": [FirewallRule(term="dog")],
            "images": [PipelineImage(id="a", url="x")],
        }
        assert "ALSO DESCRIBE THE SUBJECT" in build_visual_prompt(**kwargs, describe_subject=True)
        assert "ALSO DESCRIBE THE SUBJECT" not in build_visual_prompt(**kwargs)

    def test_rules_survive_non_latin_scripts_unescaped(self) -> None:
        prompt = build_visual_prompt(
            source_preference="لا أريد رؤية كلاب",
            rules=[FirewallRule(term="كلب")],
            images=[PipelineImage(id="a", url="x")],
        )
        assert "كلب" in prompt  # not كلب
