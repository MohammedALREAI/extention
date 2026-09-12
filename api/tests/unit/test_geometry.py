"""Coordinate arithmetic, cross-checked against the TypeScript original.

A one-pixel disagreement here is not cosmetic: it shifts the crop, which shifts the box
the verifier reports, which moves the blur off the object it was covering.
"""

import json
from pathlib import Path

import pytest

from contentfirewall.domain.geometry import (
    CROP_PADDING,
    DETECTION_MIN_EDGE,
    MAX_UPSCALED_EDGE,
    NORMALIZED,
    NormalizedBox,
    bound_target,
    box_from_crop,
    padded_region,
    region_to_pixels,
    upscale_target,
)
from contentfirewall.domain.jsc import js_round

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "geometry_golden.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))


def as_box(raw: dict) -> NormalizedBox:
    return NormalizedBox(x=raw["x"], y=raw["y"], width=raw["width"], height=raw["height"])


def approx(value: float) -> object:
    """Float comparison across two runtimes: same maths, last-bit formatting differences."""
    return pytest.approx(value, rel=1e-12, abs=1e-12)


class TestRounding:
    @pytest.mark.parametrize("case", DATA["rounding"], ids=lambda case: str(case["value"]))
    def test_matches_math_round(self, case: dict) -> None:
        assert js_round(case["value"]) == case["rounded"]

    def test_the_corpus_includes_a_value_python_rounds_the_other_way(self) -> None:
        # Without at least one of these, the cross-check would pass even if js_round were
        # a plain round() — which is exactly the bug it exists to catch.
        disagreements = [case for case in DATA["rounding"] if round(case["value"]) != case["rounded"]]
        assert disagreements, "corpus no longer distinguishes Math.round from round()"


class TestPaddedRegion:
    @pytest.mark.parametrize(
        "case",
        DATA["regions"],
        ids=lambda case: f"{case['box']['x']},{case['box']['y']} p={case['padding']}",
    )
    def test_matches_typescript(self, case: dict) -> None:
        region = padded_region(as_box(case["box"]), case["padding"])
        if case["region"] is None:
            assert region is None
            return
        assert region is not None
        assert region.x == approx(case["region"]["x"])
        assert region.y == approx(case["region"]["y"])
        assert region.width == approx(case["region"]["width"])
        assert region.height == approx(case["region"]["height"])

    def test_never_escapes_the_frame(self) -> None:
        for case in DATA["regions"]:
            region = padded_region(as_box(case["box"]), case["padding"])
            if region is None:
                continue
            assert region.x >= 0 and region.y >= 0
            assert region.x + region.width <= NORMALIZED + 1e-9
            assert region.y + region.height <= NORMALIZED + 1e-9

    def test_padding_is_relative_to_the_box_not_the_image(self) -> None:
        # A fixed margin would be most of a small crop and invisible around a large one.
        small = padded_region(NormalizedBox(400, 400, 10, 10), CROP_PADDING)
        large = padded_region(NormalizedBox(100, 100, 500, 500), CROP_PADDING)
        assert small is not None and large is not None
        assert small.width == approx(10 * (1 + 2 * CROP_PADDING))
        assert large.width == approx(500 * (1 + 2 * CROP_PADDING))


class TestRegionToPixels:
    def test_matches_typescript(self) -> None:
        checked = 0
        for case in DATA["regions"]:
            if case["pixels"] is None:
                continue
            region = padded_region(as_box(case["box"]), case["padding"])
            assert region is not None
            for entry in case["pixels"]:
                rect = region_to_pixels(region, entry["imageWidth"], entry["imageHeight"])
                assert (rect.left, rect.top, rect.width, rect.height) == (
                    entry["rect"]["left"],
                    entry["rect"]["top"],
                    entry["rect"]["width"],
                    entry["rect"]["height"],
                ), f"{case['box']} p={case['padding']} into {entry['imageWidth']}x{entry['imageHeight']}"
                checked += 1
        assert checked > 100

    def test_the_rectangle_always_fits_inside_the_image(self) -> None:
        for case in DATA["regions"]:
            region = padded_region(as_box(case["box"]), case["padding"])
            if region is None:
                continue
            for width, height in ((168, 94), (4000, 2250), (1, 1)):
                rect = region_to_pixels(region, width, height)
                assert rect.left + rect.width <= width
                assert rect.top + rect.height <= height


class TestBoxFromCrop:
    @pytest.mark.parametrize("case", DATA["mappings"], ids=lambda _: None)
    def test_matches_typescript(self, case: dict) -> None:
        mapped = box_from_crop(as_box(case["region"]), as_box(case["inner"]))
        expected = case["output"]
        assert mapped.x == approx(expected["x"])
        assert mapped.y == approx(expected["y"])
        assert mapped.width == approx(expected["width"])
        assert mapped.height == approx(expected["height"])

    def test_the_result_is_always_inside_the_original_frame(self) -> None:
        # Staying in frame is the invariant that matters — a box outside it would be drawn
        # in the wrong place or not at all.
        for case in DATA["mappings"]:
            mapped = box_from_crop(as_box(case["region"]), as_box(case["inner"]))
            assert 0 <= mapped.x <= NORMALIZED
            assert 0 <= mapped.y <= NORMALIZED
            assert mapped.x + mapped.width <= NORMALIZED + 1e-9
            assert mapped.y + mapped.height <= NORMALIZED + 1e-9
            assert mapped.width > 0 and mapped.height > 0

    def test_a_box_pinned_to_the_far_corner_is_narrower_than_the_one_unit_floor(self) -> None:
        # The clamp asks for a minimum of 1 unit but caps at the space remaining, and when
        # a box sits within a unit of the edge the cap wins. Inherited from the TypeScript
        # original and matched exactly; harmless, since such a box is a thousandth of the
        # frame — but worth pinning so it reads as known rather than as a rounding slip.
        region = NormalizedBox(x=940.0, y=940.0, width=67.2, height=67.2)
        mapped = box_from_crop(region, NormalizedBox(x=999, y=999, width=1, height=1))
        assert mapped.width < 1
        assert mapped.x + mapped.width <= NORMALIZED + 1e-9

    def test_a_full_crop_box_maps_back_onto_the_region(self) -> None:
        region = NormalizedBox(x=100, y=200, width=300, height=400)
        whole = NormalizedBox(x=0, y=0, width=NORMALIZED, height=NORMALIZED)
        mapped = box_from_crop(region, whole)
        assert (mapped.x, mapped.y) == (100, 200)
        assert mapped.width == approx(300)
        assert mapped.height == approx(400)


class TestResizeTargets:
    @pytest.mark.parametrize("case", DATA["resizes"], ids=lambda case: f"{case['width']}x{case['height']}")
    def test_matches_typescript(self, case: dict) -> None:
        upscale = upscale_target(case["width"], case["height"])
        if case["upscale"] is None:
            assert upscale is None
        else:
            assert upscale == (case["upscale"]["width"], case["upscale"]["height"])

        bound = bound_target(case["width"], case["height"])
        if case["bound"] is None:
            assert bound is None
        else:
            assert bound == (case["bound"]["width"], case["bound"]["height"])

    def test_upscaling_bounds_the_result_not_the_factor(self) -> None:
        # Capping the factor at 4 left a 168px thumbnail at 672px — short of the very floor
        # the upscale exists to reach.
        target = upscale_target(168, 94)
        assert target is not None
        assert max(target) >= DETECTION_MIN_EDGE

    def test_upscaling_a_tiny_icon_stays_within_the_ceiling(self) -> None:
        target = upscale_target(16, 16)
        assert target is not None
        assert max(target) <= MAX_UPSCALED_EDGE

    def test_a_large_image_is_bounded_and_not_upscaled(self) -> None:
        assert upscale_target(4000, 2250) is None
        assert bound_target(4000, 2250) == (1536, 864)

    def test_the_boundary_itself(self) -> None:
        assert upscale_target(DETECTION_MIN_EDGE, 100) is None  # already at the floor
        assert upscale_target(DETECTION_MIN_EDGE - 1, 100) is not None
        assert bound_target(MAX_UPSCALED_EDGE, 100) is None  # already at the ceiling
        assert bound_target(MAX_UPSCALED_EDGE + 1, 100) is not None
