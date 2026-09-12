"""Decoding and identifying uploaded image bytes — stdlib only, no image library.

The MIME a caller declares in a data URL is just text they typed. Only the leading bytes
say what a file actually is, so the stored type is derived from those and the declared
value is never trusted. That matters beyond tidiness: the sniffed extension is what ends
up in the filename and in the ``Content-Type`` of the response that serves it back, so a
PNG that claims to be an SVG must not be served as one.

Dimensions are read from the header rather than by decoding the image, because decoding a
6 MB file to learn its width is exactly the work an upload cap exists to avoid.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import math
import re
import struct
from dataclasses import dataclass
from typing import Final, Literal

MAX_UPLOAD_BYTES: Final = 6 * 1024 * 1024
MIN_SNIFF_BYTES: Final = 12

DecodeError = Literal["not_a_data_url", "too_large", "unsupported_type", "malformed_base64"]

_DATA_URL: Final = re.compile(r"^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$", re.IGNORECASE)
_DIGEST: Final = re.compile(r"^[a-f0-9]{64}$")

# JPEG start-of-frame markers carry the dimensions. 0xC4 (Huffman table), 0xC8 (JPEG
# extensions) and 0xCC (arithmetic coding conditioning) share the range but are not frames.
_JPEG_NON_FRAME: Final = frozenset({0xC4, 0xC8, 0xCC})


@dataclass(frozen=True, slots=True)
class StoredImageType:
    mime: str
    extension: str


PNG: Final = StoredImageType("image/png", "png")
JPEG: Final = StoredImageType("image/jpeg", "jpg")
GIF: Final = StoredImageType("image/gif", "gif")
WEBP: Final = StoredImageType("image/webp", "webp")

SUPPORTED_TYPES: Final = (PNG, JPEG, GIF, WEBP)
_BY_EXTENSION: Final = {image_type.extension: image_type for image_type in SUPPORTED_TYPES}


@dataclass(frozen=True, slots=True)
class ImageSize:
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class DecodedUpload:
    data: bytes
    type: StoredImageType
    sha256: str
    size: ImageSize | None = None


def detect_image_type(data: bytes) -> StoredImageType | None:
    """Identify by magic bytes. ``None`` means "not an image we accept", never a guess."""
    if len(data) < MIN_SNIFF_BYTES:
        return None
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return PNG
    if data[0] == 0xFF and data[1] == 0xD8 and data[2] == 0xFF:
        return JPEG
    if data[:4] == b"GIF8":
        return GIF
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return WEBP
    return None


def _jpeg_size(data: bytes) -> ImageSize | None:
    """Walk the segment chain to the frame header; only it carries the dimensions."""
    offset = 2
    while offset + 9 < len(data):
        if data[offset] != 0xFF:
            return None
        marker = data[offset + 1]
        (length,) = struct.unpack_from(">H", data, offset + 2)
        if 0xC0 <= marker <= 0xCF and marker not in _JPEG_NON_FRAME:
            height, width = struct.unpack_from(">HH", data, offset + 5)
            return ImageSize(width=width, height=height)
        # Always advances by at least 2 even on a malformed zero-length segment, so the
        # walk terminates without needing a guard that would reject a file Node accepted.
        offset += 2 + length
    return None


def image_dimensions(data: bytes, image_type: StoredImageType) -> ImageSize | None:
    """Intrinsic size from the header — ``None`` rather than a guess when unreadable."""
    try:
        if image_type is PNG:
            width, height = struct.unpack_from(">II", data, 16)
            return ImageSize(width=width, height=height)
        if image_type is GIF:
            width, height = struct.unpack_from("<HH", data, 6)
            return ImageSize(width=width, height=height)
        if image_type is JPEG:
            return _jpeg_size(data)
    except (struct.error, IndexError):
        return None
    return None


def decode_image_data_url(value: object) -> DecodedUpload | DecodeError:
    """Decode, size-check and identify a base64 data URL.

    The encoded length is checked *before* decoding: materialising a huge buffer just to
    measure it is the memory spike the cap is meant to prevent.
    """
    if not isinstance(value, str):
        return "not_a_data_url"
    match = _DATA_URL.match(value.strip())
    if not match:
        return "not_a_data_url"

    encoded = match.group(2)
    if len(encoded) > math.ceil(MAX_UPLOAD_BYTES / 3) * 4:
        return "too_large"

    # Node's Buffer.from(..., "base64") ignores whitespace and tolerates missing padding.
    # Python's decoder does neither, so both are normalised here rather than letting a
    # payload Node accepted fail only on the Python server.
    compact = re.sub(r"\s+", "", encoded)
    padded = compact + "=" * (-len(compact) % 4)
    try:
        data = base64.b64decode(padded, validate=False)
    except (binascii.Error, ValueError):
        return "malformed_base64"

    if not data:
        return "malformed_base64"
    if len(data) > MAX_UPLOAD_BYTES:
        return "too_large"

    image_type = detect_image_type(data)
    if image_type is None:
        return "unsupported_type"

    return DecodedUpload(
        data=data,
        type=image_type,
        sha256=hashlib.sha256(data).hexdigest(),
        size=image_dimensions(data, image_type),
    )


def type_for_extension(extension: str) -> StoredImageType | None:
    return _BY_EXTENSION.get(extension)


def stored_file_name(sha256: str, image_type: StoredImageType) -> str:
    """Content-addressed, so no caller-supplied string ever reaches the filesystem.

    Raises rather than sanitising: a name that is not a digest did not come from us, and
    quietly cleaning it up would hide the fact that something is calling this wrongly.
    """
    if not _DIGEST.match(sha256):
        raise ValueError("Refusing to build a path from a non-digest name.")
    return f"{sha256}.{image_type.extension}"


def to_data_url(data: bytes, image_type: StoredImageType) -> str:
    return f"data:{image_type.mime};base64,{base64.b64encode(data).decode('ascii')}"
