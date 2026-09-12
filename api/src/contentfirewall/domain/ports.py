"""The interfaces the domain needs from the outside world.

Protocols, not base classes: an adapter satisfies one by having the right shape, so
nothing in ``adapters/`` has to import from here and the dependency arrow stays pointing
inward. A test satisfies one with a twenty-line fake.

This is what keeps the detection pipeline runnable with no network, no database, no
subprocess and no event-loop tricks — which is the difference between sixty fast tests and
sixty flaky ones.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

from contentfirewall.domain.geometry import PixelRect


@dataclass(frozen=True, slots=True)
class ModelImage:
    """An image to send with a prompt, already inlined as a data URL or referenced by URL."""

    url: str
    detail: Literal["high", "low", "auto"] = "high"


@dataclass(frozen=True, slots=True)
class ModelCall:
    """One request to a logical route, not to a named model.

    The route decides which models are tried and in what order; the caller never names a
    model, so swapping providers is configuration rather than a code change.
    """

    route: str
    prompt: str
    images: Sequence[ModelImage] = ()
    max_tokens: int = 1_000
    json_object: bool = True
    # A strict JSON schema, when the answer's shape matters enough to have the gateway
    # enforce it rather than discovering the problem while parsing. The semantic route uses
    # one; the visual route cannot, because its box arrays vary too much to pin usefully.
    response_schema: Mapping[str, Any] | None = None
    system_prompt: str | None = None
    # Parsing belongs *inside* the route ladder, not after it. A model that answers with
    # empty or malformed content is as broken as one that times out; if the parse happens
    # afterwards the ladder counts that answer a success and never tries the next model,
    # turning a recoverable provider quirk into a failed request.
    # Excluded from equality so a call stays comparable in tests.
    parse: Callable[[Any], Any] | None = field(default=None, compare=False)


@dataclass(frozen=True, slots=True)
class ModelAnswer:
    content: Any
    model: str
    attempts: int
    # What ``ModelCall.parse`` produced, when one was supplied. Callers that pass a parser
    # read this rather than re-parsing content the ladder already validated.
    value: Any = None


@runtime_checkable
class ModelGateway(Protocol):
    """Runs a prompt against a route, retrying across models and tripping their breakers."""

    # ASYNC109 would have the caller wrap this in `asyncio.timeout` instead. That is the
    # right advice for a single operation and the wrong one here: the gateway tries several
    # models in turn, and this budget bounds the *ladder*, while each attempt also carries
    # its own per-route timeout. An outer wrapper could only express one of the two.
    async def invoke(self, call: ModelCall, *, timeout: float | None = None) -> ModelAnswer: ...  # noqa: ASYNC109


@dataclass(frozen=True, slots=True)
class FetchedImage:
    data: bytes
    mime: str


@runtime_checkable
class ImageFetcher(Protocol):
    """Fetches bytes for a URL a web page supplied — hence the SSRF guarding in the adapter.

    Returns ``None`` rather than raising when the image cannot be had: the pipeline then
    simply does less, which is the correct response to an image we cannot reach.
    """

    async def fetch(self, url: str) -> FetchedImage | None: ...


@dataclass(frozen=True, slots=True)
class ImageInfo:
    width: int
    height: int


@runtime_checkable
class ImageOps(Protocol):
    """Pixel work. CPU-bound, so the adapter runs it off the event loop.

    Every method returns ``None`` on undecodable input rather than raising — a corrupt
    image must degrade one detection, not fail the batch.
    """

    async def info(self, data: bytes) -> ImageInfo | None: ...

    async def resize(self, data: bytes, width: int, height: int) -> bytes | None: ...

    async def crop(self, data: bytes, rect: PixelRect) -> bytes | None: ...

    async def to_jpeg(self, data: bytes, quality: int = 82) -> bytes | None: ...
