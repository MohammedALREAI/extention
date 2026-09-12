"""JavaScript string and regex semantics, for the frozen wire contracts only.

The extension and developer APIs were specified by a Node implementation, and their
length bounds are therefore **UTF-16 code units**, not Unicode code points. The two
counts differ for any character outside the Basic Multilingual Plane — every emoji, and
a good deal of CJK Extension B. A page caption containing one emoji is 2 units in
JavaScript and 1 code point in Python.

That difference is invisible in review and changes two things that matter:

* an id of 119 code points / 121 code units is **rejected** by the Node server
  (``extensionSemanticApi.ts:143``) but would be accepted by a naive Python port, and a
  rejected image is silently dropped from a batch;
* a caption truncated at 200 leaves a different string, so the prompt differs and the
  decision can differ.

Use these helpers **only** where a bound was inherited from the TypeScript server. New
code uses ordinary Python slicing, because ordinary Python slicing is what a reader
expects.
"""

from __future__ import annotations

import math
import re
from typing import Final

__all__ = [
    "JS_WORD_BOUNDARY_FLAGS",
    "js_len",
    "js_lower",
    "js_number",
    "js_slice",
    "js_string",
    "js_truncate",
]

NAN: Final = math.nan


def js_len(value: str) -> int:
    """Length in UTF-16 code units — JavaScript's ``String.prototype.length``.

    Every code point above U+FFFF is stored as a surrogate pair and counts twice.
    """
    return len(value) + sum(1 for character in value if ord(character) > 0xFFFF)


def js_slice(value: str, start: int = 0, end: int | None = None) -> str:
    """Slice by UTF-16 code unit, as ``String.prototype.slice`` does.

    One deliberate difference from JavaScript: cutting through a surrogate pair yields a
    lone surrogate in JS, which is not a valid character and cannot be encoded to UTF-8
    at all. Rather than carry an unencodable string through the rest of the request, the
    partial character is dropped. The result is at most one character shorter than JS
    would produce, and that character was going to reach the model mangled either way.
    """
    if not value:
        return ""
    # Fast path: no astral characters means code units and code points coincide.
    if js_len(value) == len(value):
        return value[start:end]

    # An astral character occupies two slots and must survive only when both are taken.
    # Its text therefore sits in the *second* slot: a cut landing between the two keeps
    # the empty leading slot and drops the character, which is the behaviour we want.
    units: list[str] = []
    for character in value:
        if ord(character) > 0xFFFF:
            units.append("")  # the high surrogate's slot, carrying no text of its own
        units.append(character)
    return "".join(units[start:end])


def js_truncate(value: str, limit: int) -> str:
    """``value.slice(0, limit)`` — the shape almost every call site actually wants."""
    return js_slice(value, 0, limit)


def js_lower(value: str) -> str:
    """``String.prototype.toLocaleLowerCase()`` with no locale argument.

    This is ``str.lower()``, **never** ``str.casefold()``. Casefolding maps ``ß`` to
    ``ss`` and ``ﬁ`` to ``fi``, which JavaScript does not do — and these strings become
    cache keys and rule terms, so a different mapping is a different decision.
    """
    return value.lower()


_MISSING: Final = object()

# What JavaScript's Number() accepts: optional sign, decimal/hex/octal/binary literals,
# exponents, and Infinity. Leading and trailing whitespace is stripped first.
_JS_DECIMAL = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")
_JS_RADIX = re.compile(r"^0[xX][0-9a-fA-F]+$|^0[oO][0-7]+$|^0[bB][01]+$")


def js_number(value: object, missing: object = _MISSING) -> float:
    """``Number(value)`` — including the parts that surprise people.

    The model's JSON is not trusted to hold numbers where numbers belong, and the Node
    parser leaned on these coercions: ``Number(null)`` is ``0`` and passes the finiteness
    check, while ``Number(undefined)`` is ``NaN`` and fails it. A Python port that called
    ``float()`` would raise on the first and reject the second identically — turning a
    box the Node server accepted into one it drops, or vice versa.

    Pass ``missing`` when the key was absent, so ``undefined`` can be told from ``null``.
    """
    if value is missing or value is _MISSING:
        return NAN
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0.0
        if text in ("Infinity", "+Infinity"):
            return math.inf
        if text == "-Infinity":
            return -math.inf
        if _JS_DECIMAL.match(text):
            return float(text)
        if _JS_RADIX.match(text):
            return float(int(text, 0))
        return NAN
    if isinstance(value, list):
        # Number([]) is 0, Number([5]) is 5, Number([1,2]) is NaN — via toString().
        if not value:
            return 0.0
        return js_number(value[0]) if len(value) == 1 else NAN
    return NAN


def js_string(value: object, default: str = "") -> str:
    """``String(value ?? default)`` — nullish coalescing, then stringification.

    Only ``null`` and ``undefined`` fall back to the default; ``0``, ``false`` and ``""``
    stringify as themselves, which is the whole point of ``??`` over ``||``.
    """
    if value is None or value is _MISSING:
        return default
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if isinstance(value, float) and value.is_integer() and math.isfinite(value):
        return str(int(value))  # JS prints 80.0 as "80"
    return str(value)


# JavaScript's ``\b`` is ASCII-only; Python's is Unicode-aware by default, so ``\bor\b``
# would match inside an Arabic or accented word that JavaScript leaves alone. Compile any
# pattern ported from the TypeScript server with these flags to restore JS behaviour.
JS_WORD_BOUNDARY_FLAGS = re.ASCII
