"""Value objects shared across the domain.

Frozen, so a box that survived filtering cannot be mutated by a later pass, and so the
pipeline's intermediate results are safe to share between concurrent tasks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal


class PolicyAction(StrEnum):
    BLUR = "blur"
    BLOCK = "block"
    WARN = "warn"


class Decision(StrEnum):
    ALLOW = "allow"
    BLUR = "blur"
    BLOCK = "block"
    WARN = "warn"
    UNCERTAIN = "uncertain"


class InputType(StrEnum):
    TEXT = "text"
    IMAGE = "image"


class CacheStatus(StrEnum):
    FRESH = "fresh"
    CACHED = "cached"


@dataclass(frozen=True, slots=True)
class FirewallRule:
    term: str
    action: PolicyAction = PolicyAction.BLUR


@dataclass(frozen=True, slots=True)
class FirewallScope:
    text: bool = True
    images: bool = True


@dataclass(frozen=True, slots=True)
class VisualBox:
    """A detected object, in the normalized 1000x1000 coordinate space.

    ``mask`` is reserved for pixel-level segmentation (polygon or RLE) and is carried
    through untouched so the shape can grow without breaking clients that only read boxes.
    """

    x: float
    y: float
    width: float
    height: float
    label: str
    confidence: float
    mask: Any = None

    @property
    def area(self) -> float:
        return self.width * self.height

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height


@dataclass(frozen=True, slots=True)
class VisualDetection:
    """One entry per supplied image id — always one, even when nothing was found.

    ``status="unavailable"`` means the image could not be inspected. It is emphatically
    not a no-match: the extension caches an unavailable result for ten seconds and a
    no-match for ten minutes, so conflating them leaves an unprotected image on screen.
    """

    id: str
    boxes: tuple[VisualBox, ...] = ()
    subject: str | None = None
    status: Literal["unavailable"] | None = None

    @property
    def unavailable(self) -> bool:
        return self.status == "unavailable"


@dataclass(frozen=True, slots=True)
class PipelineImage:
    id: str
    url: str
    width: int | None = None
    height: int | None = None
    context: str = ""


@dataclass(frozen=True, slots=True)
class ParsedPreference:
    language: Literal["ar", "en"]
    action: PolicyAction
    rules: tuple[FirewallRule, ...] = ()
    notes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CheckResult:
    decision: Decision
    confidence: float
    reason: str
    cache_status: CacheStatus
    matched_terms: tuple[str, ...] = field(default_factory=tuple)
    uncertain: bool = False
