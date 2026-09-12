"""Ported from server/visualPipeline.test.ts.

The assertions that matter most here are about *call count*, not boxes. The whole design
of this pipeline is a cost argument — easy image one call, uncertain two, hard small image
three, never one per box — and a regression that quietly adds a fourth call to every
request is invisible in the output and expensive in the bill.
"""

import pytest

from contentfirewall.domain.deadline import EXTRA_PASS_MIN_REMAINING_S, Deadline
from contentfirewall.domain.errors import ModelReplyError
from contentfirewall.domain.models import FirewallRule, PipelineImage, VisualBox
from contentfirewall.domain.visual_pipeline import (
    FAST,
    THOROUGH,
    VERIFY_AREA_RATIO_BELOW,
    VERIFY_CONFIDENCE_BELOW,
    VERIFY_OVERLAP_COUNT,
    PipelineRequest,
    decode_data_url,
    detect_images,
    load_pixels,
    needs_verification,
)
from tests.fakes import FakeImageFetcher, FakeImageOps, FakeModelGateway

URL = "https://example.test/a.jpg"


def request(**overrides) -> PipelineRequest:
    base = {
        "source_preference": "Do not show me: dog",
        "rules": [FirewallRule(term="dog")],
        "images": [PipelineImage(id="a", url=URL)],
        "effort": THOROUGH,
    }
    return PipelineRequest(**(base | overrides))


def box(**overrides) -> dict:
    return {"x": 200, "y": 200, "width": 400, "height": 400, "label": "dog", "confidence": 0.95} | overrides


def detections(*entries: dict) -> dict:
    return {"detections": list(entries)}


def a_clock(elapsed: list[float]):
    """A monotonic clock a test can advance by one call at a time."""
    ticks = iter(elapsed)
    last = 0.0

    def now() -> float:
        nonlocal last
        last = next(ticks, last)
        return last

    return now


class TestNeedsVerification:
    def test_accepts_a_confident_central_sizeable_box_without_verifying(self) -> None:
        strong = VisualBox(x=200, y=200, width=400, height=400, label="dog", confidence=0.95)
        assert needs_verification([strong]) is False
        assert needs_verification([]) is False

    @pytest.mark.parametrize(
        "boxes",
        [
            [VisualBox(200, 200, 400, 400, "dog", 0.7)],       # weak
            [VisualBox(200, 200, 100, 100, "dog", 0.95)],      # small
            [VisualBox(0, 200, 400, 400, "dog", 0.95)],        # at an edge
            [VisualBox(200, 700, 400, 300, "dog", 0.95)],      # at the bottom edge
            [VisualBox(200, 200, 400, 400, "dog", 0.95)] * 3,  # crowded
        ],
        ids=["weak", "small", "edge-left", "edge-bottom", "crowded"],
    )
    def test_verifies_a_result_that_is_weak_small_clipped_or_crowded(self, boxes: list) -> None:
        assert needs_verification(boxes) is True

    def test_the_trigger_thresholds(self) -> None:
        assert VERIFY_CONFIDENCE_BELOW == 0.8
        assert VERIFY_AREA_RATIO_BELOW == 0.05
        assert VERIFY_OVERLAP_COUNT == 3


class TestLoadPixels:
    async def test_reads_an_inline_data_url_without_touching_the_network(self) -> None:
        fetcher = FakeImageFetcher()
        data = await load_pixels("data:image/jpeg;base64,aGVsbG8=", fetcher)
        assert data == b"hello"
        assert fetcher.requested == []

    async def test_returns_nothing_when_a_remote_image_is_refused(self) -> None:
        assert await load_pixels("https://169.254.169.254/x.png", FakeImageFetcher()) is None

    def test_a_malformed_data_url_is_not_mistaken_for_one(self) -> None:
        assert decode_data_url("data:image/png,notbase64") is None
        assert decode_data_url("https://example.test/a.png") is None


class TestCallBudget:
    async def test_fast_mode_makes_exactly_one_call_and_never_verifies(self) -> None:
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": [box(confidence=0.6)]})])
        await detect_images(
            request(effort=FAST),
            model=model,
            fetcher=FakeImageFetcher(),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert model.call_count == 1

    async def test_an_easy_image_costs_one_call_in_thorough_mode_too(self) -> None:
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": [box()]})])
        result = await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1200, 900)}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert model.call_count == 1
        assert len(result[0].boxes) == 1

    async def test_an_uncertain_result_costs_two(self) -> None:
        model = FakeModelGateway(
            replies=[
                detections({"id": "a", "boxes": [box(confidence=0.7)]}),
                {"verdicts": [{"cropId": "a#0", "present": True}]},
            ]
        )
        result = await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1200, 900)}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert model.call_count == 2
        # A confirmed box takes the agreed confidence, not the model's own number.
        assert result[0].boxes[0].confidence == 0.94

    async def test_many_boxes_still_cost_one_verification_call(self) -> None:
        # The rule this protects: never one model call per box.
        weak = [box(x=i * 120, y=0, width=100, height=300, label=f"dog-{i}", confidence=0.7) for i in range(6)]
        model = FakeModelGateway(
            replies=[detections({"id": "a", "boxes": weak}), {"verdicts": []}]
        )
        await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1200, 900)}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert model.call_count == 2


class TestVerification:
    async def test_drops_a_candidate_the_verifier_rejects(self) -> None:
        model = FakeModelGateway(
            replies=[
                detections({"id": "a", "boxes": [box(confidence=0.7)]}),
                {"verdicts": [{"cropId": "a#0", "present": False}]},
            ]
        )
        result = await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1200, 900)}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert result[0].boxes == ()

    async def test_tightens_a_confirmed_box_to_the_verifier_coordinates(self) -> None:
        model = FakeModelGateway(
            replies=[
                detections({"id": "a", "boxes": [box(confidence=0.7)]}),
                {"verdicts": [{"cropId": "a#0", "present": True, "box": {"x": 100, "y": 100, "width": 500, "height": 500}}]},
            ]
        )
        result = await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1200, 900)}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        (only,) = result[0].boxes
        assert (only.x, only.y) != (200, 200)  # moved to the verifier's coordinates
        assert only.confidence == 0.94

    @pytest.mark.parametrize(
        "failure", [ModelReplyError("garbage"), TimeoutError()], ids=["unparseable", "timeout"]
    )
    async def test_a_failed_verification_keeps_the_pass_one_result(self, failure: Exception) -> None:
        # A broken second look must never be worse than not looking twice.
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": [box(confidence=0.7)]}), failure])
        result = await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1200, 900)}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert len(result[0].boxes) == 1
        assert result[0].boxes[0].confidence == 0.7

    async def test_never_verifies_an_image_reported_unavailable(self) -> None:
        model = FakeModelGateway(replies=[detections({"id": "a", "status": "unavailable", "boxes": []})])
        result = await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1200, 900)}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert model.call_count == 1
        assert result[0].unavailable is True


class TestSmallImageRetry:
    async def test_retries_a_small_image_that_came_back_empty_then_stops(self) -> None:
        ops = FakeImageOps()
        model = FakeModelGateway(
            replies=[
                detections({"id": "a", "boxes": []}),
                detections({"id": "a", "boxes": [box()]}),
            ]
        )
        result = await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(168, 94)}),
            ops=ops,
            deadline=Deadline.unlimited(),
        )
        assert model.call_count == 2  # and not a third
        assert len(result[0].boxes) == 1

    async def test_does_not_retry_a_large_image_that_legitimately_contains_nothing(self) -> None:
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": []})])
        await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1600, 1200)}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert model.call_count == 1

    async def test_a_failed_retry_leaves_the_empty_result_untouched(self) -> None:
        model = FakeModelGateway(
            replies=[detections({"id": "a", "boxes": []}), ModelReplyError("nope")]
        )
        result = await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(168, 94)}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert result[0].boxes == ()


class TestDeadline:
    async def test_skips_the_extra_pass_when_too_little_budget_remains(self) -> None:
        # Starting a pass that gets cut off spends the money and produces nothing; skipping
        # it leaves the pass-1 answer intact.
        spent = EXTRA_PASS_MIN_REMAINING_S + 1
        clock = a_clock([0.0] + [spent] * 20)
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": [box(confidence=0.7)]})])
        result = await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1200, 900)}),
            ops=FakeImageOps(),
            deadline=Deadline.after(EXTRA_PASS_MIN_REMAINING_S + 2, now=clock),
        )
        assert model.call_count == 1
        assert result[0].boxes[0].confidence == 0.7  # pass 1 stands

    async def test_passes_the_remaining_budget_down_to_the_model_call(self) -> None:
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": [box()]})])
        await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1200, 900)}),
            ops=FakeImageOps(),
            deadline=Deadline.after(15.0),
        )
        assert model.timeouts[0] is not None
        assert 0 < model.timeouts[0] <= 15.0


class TestPixelPreparation:
    async def test_sends_fetched_pixels_inline_rather_than_the_url(self) -> None:
        # Handing over a URL makes the provider fetch it from its own network; a host that
        # refuses that fetch failed the whole call and looked exactly like "no match".
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": []})])
        await detect_images(
            request(images=[PipelineImage(id="a", url=URL)]),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1600, 1200)}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert model.calls[0].images[0].url.startswith("data:image/jpeg;base64,")

    async def test_falls_back_to_the_url_when_the_bytes_cannot_be_decoded(self) -> None:
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": []})])
        await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: b"not an image"}),
            ops=FakeImageOps(),
            deadline=Deadline.unlimited(),
        )
        assert model.calls[0].images[0].url == URL

    async def test_raises_a_thumbnail_to_the_detection_floor(self) -> None:
        ops = FakeImageOps()
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": [box()]})])
        await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(168, 94)}),
            ops=ops,
            deadline=Deadline.unlimited(),
        )
        assert ops.resizes, "a 168x94 thumbnail must be upscaled before detection"
        assert max(ops.resizes[0]) >= 768

    async def test_bounds_a_huge_photo_instead_of_inlining_all_of_it(self) -> None:
        ops = FakeImageOps()
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": [box()]})])
        await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(4000, 2250)}),
            ops=ops,
            deadline=Deadline.unlimited(),
        )
        assert ops.resizes == [(1536, 864)]

    async def test_an_image_of_a_comfortable_size_is_not_resized_at_all(self) -> None:
        ops = FakeImageOps()
        model = FakeModelGateway(replies=[detections({"id": "a", "boxes": [box()]})])
        await detect_images(
            request(),
            model=model,
            fetcher=FakeImageFetcher({URL: FakeImageOps.image(1000, 800)}),
            ops=ops,
            deadline=Deadline.unlimited(),
        )
        assert ops.resizes == []
