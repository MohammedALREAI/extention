"""Image identification and decoding, cross-checked against the TypeScript store.

The sniffed type decides the stored filename and the Content-Type the file is served back
with, so "declared PNG, actually something else" is a security question, not a tidiness
one. Those cases are in the corpus deliberately.
"""

import base64
import json
from pathlib import Path

import pytest

from contentfirewall.domain.image_bytes import (
    JPEG,
    MAX_UPLOAD_BYTES,
    PNG,
    DecodedUpload,
    decode_image_data_url,
    detect_image_type,
    image_dimensions,
    stored_file_name,
    to_data_url,
    type_for_extension,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "image_bytes_golden.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", DATA["sniffing"], ids=lambda case: case["name"])
def test_sniffing_matches_typescript(case: dict) -> None:
    data = base64.b64decode(case["base64"])
    image_type = detect_image_type(data)

    if case["type"] is None:
        assert image_type is None
        return
    assert image_type is not None
    assert image_type.mime == case["type"]["mime"]
    assert image_type.extension == case["type"]["extension"]

    size = image_dimensions(data, image_type)
    if case["dimensions"] is None:
        assert size is None
    else:
        assert size is not None
        assert (size.width, size.height) == (case["dimensions"]["width"], case["dimensions"]["height"])


@pytest.mark.parametrize("case", DATA["decoding"], ids=lambda case: case["name"])
def test_decoding_matches_typescript(case: dict) -> None:
    # The fixture cannot carry a non-string input through JSON, so it records the kind.
    value: object = case["input"] if case["inputKind"] == "string" else (
        12345 if case["inputKind"] == "number" else None
    )
    result = decode_image_data_url(value)
    expected = case["output"]

    if "error" in expected:
        assert result == expected["error"], case["name"]
        return

    assert isinstance(result, DecodedUpload)
    assert result.sha256 == expected["sha256"]
    assert len(result.data) == expected["byteLength"]
    assert result.type.mime == expected["type"]["mime"]
    assert result.type.extension == expected["type"]["extension"]
    if expected["dimensions"] is None:
        assert result.size is None
    else:
        assert result.size is not None
        assert (result.size.width, result.size.height) == (
            expected["dimensions"]["width"],
            expected["dimensions"]["height"],
        )


def test_the_corpus_covers_the_cases_that_matter() -> None:
    names = {case["name"] for case in DATA["decoding"]}
    assert "declared jpeg but png bytes" in names
    assert "declared svg but png bytes" in names
    errors = {case["output"].get("error") for case in DATA["decoding"]}
    assert {"not_a_data_url", "too_large", "unsupported_type", "malformed_base64"} <= errors

    sniffed = {case["type"]["mime"] for case in DATA["sniffing"] if case["type"]}
    assert sniffed == {"image/png", "image/jpeg", "image/gif", "image/webp"}


class TestDeclaredTypeIsNeverTrusted:
    def test_the_stored_type_comes_from_the_bytes(self) -> None:
        png_bytes = base64.b64decode(
            next(case["base64"] for case in DATA["sniffing"] if case["name"] == "png 275x183")
        )
        lying = to_data_url(png_bytes, JPEG)  # claims JPEG, carries PNG
        result = decode_image_data_url(lying)
        assert isinstance(result, DecodedUpload)
        assert result.type is PNG
        assert result.type.extension == "png"


class TestPathSafety:
    def test_builds_a_name_only_from_a_digest(self) -> None:
        assert stored_file_name("a" * 64, PNG) == f"{'a' * 64}.png"

    @pytest.mark.parametrize(
        "name",
        ["../../etc/passwd", "a" * 63, "a" * 65, "A" * 64, "g" * 64, "", "a/b", "a" * 64 + "/x"],
        ids=["traversal", "short", "long", "uppercase", "non-hex", "empty", "slash", "suffix"],
    )
    def test_refuses_anything_that_is_not_a_digest(self, name: str) -> None:
        # Raising rather than sanitising: a non-digest name did not come from us, and
        # quietly cleaning it up would hide a caller that is wrong.
        with pytest.raises(ValueError, match="non-digest"):
            stored_file_name(name, PNG)

    def test_extension_lookup_is_closed(self) -> None:
        assert type_for_extension("png") is PNG
        assert type_for_extension("svg") is None
        assert type_for_extension("../png") is None


class TestSizeCap:
    def test_the_cap_is_six_megabytes_and_agrees_with_typescript(self) -> None:
        assert MAX_UPLOAD_BYTES == 6 * 1024 * 1024 == DATA["maxUploadBytes"]

    def test_rejects_on_encoded_length_before_decoding(self) -> None:
        # Decoding a huge payload just to measure it is the spike the cap exists to stop,
        # so an oversized string must be refused without ever being materialised.
        oversized = "data:image/png;base64," + "A" * (MAX_UPLOAD_BYTES // 3 * 4 + 8)
        assert decode_image_data_url(oversized) == "too_large"
