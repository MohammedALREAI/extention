"""The request's time budget, threaded explicitly rather than hidden in a contextvar.

The extension aborts a visual call at 20 seconds — a number compiled into copies already
installed in browsers that nobody can force-update — so the server's budget is 15 seconds
and every extra model pass has to fit inside what remains. A pass that starts too late
produces an answer no client will ever read, which costs money and protects nobody.

Monotonic, not wall clock. The TypeScript version used ``Date.now()``, which an NTP step
mid-request can move backwards; a deadline that jumps is worse than no deadline, because
it either aborts work that had time or runs work that did not.

Explicit rather than ambient: a test has to be able to say "pretend 12 seconds are gone"
in one line, and a contextvar would make that a fixture.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Final

# A second model call needs roughly this long; below it the pass is not worth starting.
EXTRA_PASS_MIN_REMAINING_S: Final = 8.0


@dataclass(frozen=True, slots=True)
class Deadline:
    """A point in monotonic time, plus the questions worth asking about it."""

    at: float
    _now: Callable[[], float] = field(default=time.monotonic, compare=False, repr=False)

    @classmethod
    def after(cls, seconds: float, now: Callable[[], float] = time.monotonic) -> Deadline:
        return cls(at=now() + seconds, _now=now)

    @classmethod
    def unlimited(cls) -> Deadline:
        return cls(at=float("inf"), _now=lambda: 0.0)

    def remaining(self) -> float:
        """Seconds left, clamped at zero — never negative, so callers can pass it on."""
        return max(0.0, self.at - self._now())

    def expired(self) -> bool:
        return self.remaining() <= 0.0

    def can_afford(self, seconds: float = EXTRA_PASS_MIN_REMAINING_S) -> bool:
        """Whether another pass of this length is worth starting at all.

        Deliberately asked *before* the work begins. A caller that starts a pass and gets
        cut off mid-flight has spent the money and has nothing to show; skipping it leaves
        the pass-1 answer intact, which is the whole point of the budget.
        """
        return self.remaining() >= seconds

    def budget_for(self, seconds: float) -> float:
        """The smaller of a step's own timeout and what is actually left."""
        return min(seconds, self.remaining())
