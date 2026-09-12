"""In-memory stand-ins for the domain's ports.

Every one records what it was asked, because the interesting assertions in a detection
test are about *how many* model calls happened and *what was in the prompt* — not just
about the boxes that came back.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from contentfirewall.domain.geometry import PixelRect
from contentfirewall.domain.ports import (
    FetchedImage,
    ImageInfo,
    ModelAnswer,
    ModelCall,
)


@dataclass
class FakeModelGateway:
    """Answers from a scripted queue, and remembers every call.

    Replies are consumed in order so a test can say "pass 1 finds a weak box, pass 2
    rejects it". A queue that runs dry raises rather than repeating the last answer,
    because an unexpected extra model call is exactly the regression worth failing on.
    """

    replies: list[object] = field(default_factory=list)
    calls: list[ModelCall] = field(default_factory=list)
    timeouts: list[float | None] = field(default_factory=list)
    error: Exception | None = None

    async def invoke(self, call: ModelCall, *, timeout: float | None = None) -> ModelAnswer:  # noqa: ASYNC109
        self.calls.append(call)
        self.timeouts.append(timeout)
        if self.error is not None:
            raise self.error
        if not self.replies:
            raise AssertionError(f"unexpected model call #{len(self.calls)} to route {call.route!r}")
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        content = reply if isinstance(reply, str) else json.dumps(reply)
        # The real gateway parses inside its retry ladder, so a parse failure surfaces as a
        # failed call rather than as a successful one carrying unusable content. The fake
        # must do the same or tests would pass against behaviour production does not have.
        value = call.parse(content) if call.parse is not None else None
        return ModelAnswer(content=content, model="fake/model", attempts=1, value=value)

    @property
    def call_count(self) -> int:
        return len(self.calls)


@dataclass
class FakeImageFetcher:
    """Returns canned bytes per URL; anything unknown is unreachable, as on the real web."""

    by_url: dict[str, bytes] = field(default_factory=dict)
    requested: list[str] = field(default_factory=list)

    async def fetch(self, url: str) -> FetchedImage | None:
        self.requested.append(url)
        data = self.by_url.get(url)
        return FetchedImage(data=data, mime="image/jpeg") if data is not None else None


@dataclass
class FakeImageOps:
    """Pretends to be libvips.

    Byte payloads are the literal string ``b"img:<width>x<height>"``, so a test can assert
    on the size the pipeline asked for without encoding a real image. Anything that does
    not parse is treated as undecodable — which is the path a corrupt upload takes.
    """

    crops: list[PixelRect] = field(default_factory=list)
    resizes: list[tuple[int, int]] = field(default_factory=list)
    jpeg_calls: int = 0
    fail_info_for: set[bytes] = field(default_factory=set)

    @staticmethod
    def image(width: int, height: int) -> bytes:
        return f"img:{width}x{height}".encode()

    async def info(self, data: bytes) -> ImageInfo | None:
        if data in self.fail_info_for:
            return None
        try:
            body = data.decode("ascii")
            width, height = body.removeprefix("img:").split("x")
            return ImageInfo(width=int(width), height=int(height))
        except (UnicodeDecodeError, ValueError):
            return None

    async def resize(self, data: bytes, width: int, height: int) -> bytes | None:
        self.resizes.append((width, height))
        return self.image(width, height)

    async def crop(self, data: bytes, rect: PixelRect) -> bytes | None:
        self.crops.append(rect)
        return self.image(rect.width, rect.height)

    async def to_jpeg(self, data: bytes, quality: int = 82) -> bytes | None:
        self.jpeg_calls += 1
        return data
