"""Input normalisation for the frozen endpoints — coerce and drop, never reject.

These are deliberately *not* Pydantic models. The contract is tolerant by design: an
over-long id or a ``javascript:`` URL removes that one image and the rest of the batch
proceeds, and the request only fails when nothing survives. A strict model would turn a
partially-bad batch into a 422, which ``extension/visualClient.js`` treats as terminal and
non-retryable — so one malformed image would silently disable protection for a whole page.

Every length bound here is in **UTF-16 code units**, because that is what the Node
implementation measured. Confirmed against the live server: an id of 60 emoji is 120 code
units and accepted, 61 emoji is 122 and rejected, while ``len()`` would have seen 60 and 61.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Final

from contentfirewall.domain.jsc import js_len, js_lower, js_number, js_string, js_truncate

MAX_IMAGES: Final = 6
MAX_RESULTS: Final = 12
MAX_IMAGE_ID_LENGTH: Final = 120
MAX_RESULT_ID_LENGTH: Final = 80
MAX_IMAGE_URL_LENGTH: Final = 2_000
MAX_INLINE_IMAGE_LENGTH: Final = 200_000
MAX_IMAGE_CONTEXT_LENGTH: Final = 200
MAX_RESULT_TEXT_LENGTH: Final = 3_500
MIN_RESULT_TEXT_LENGTH: Final = 3
MAX_DIMENSION: Final = 10_000
MAX_RULE_TERMS: Final = 20
MIN_RULE_TERM_LENGTH: Final = 2
MAX_RULE_TERM_LENGTH: Final = 40

_INLINE_IMAGE: Final = re.compile(
    r"^data:image/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=\s]+$", re.IGNORECASE
)
# Control characters, bidi overrides and zero-width joiners are invisible in review but
# reshape the prompt they land in. Caption text comes from the page, so it is hostile input.
_INVISIBLE: Final = re.compile(r"[\x00-\x1f\x7f​-‏‪-‮⁠-⁤﻿]")


@dataclass(frozen=True, slots=True)
class NormalizedImage:
    id: str
    url: str
    width: int | None = None
    height: int | None = None
    context: str = ""


@dataclass(frozen=True, slots=True)
class NormalizedResult:
    id: str
    text: str


def _dimension(value: Any) -> int | None:
    number = js_number(value)
    if number != number or number <= 0:  # NaN or non-positive
        return None
    return min(int(number), MAX_DIMENSION)


def _clean_context(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    import unicodedata

    text = unicodedata.normalize("NFC", value)
    return js_truncate(_INVISIBLE.sub("", text).strip(), MAX_IMAGE_CONTEXT_LENGTH)


def normalize_images(payload: Any) -> list[NormalizedImage]:
    """Accepted images, in order. An image that fails any rule is dropped, not fatal."""
    source = payload.get("images") if isinstance(payload, dict) else None
    if not isinstance(source, list):
        return []

    images: list[NormalizedImage] = []
    for item in source[:MAX_IMAGES]:
        if not isinstance(item, dict):
            continue
        identifier = js_string(item.get("id")).strip()
        # Never truncated. A truncated id comes back unmatched, and an unmatched image
        # reads to the extension as a confident no-match — the image stays uncovered.
        if not identifier or js_len(identifier) > MAX_IMAGE_ID_LENGTH:
            continue

        url = js_string(item.get("url")).strip()
        if url.lower().startswith("https://") and js_len(url) <= MAX_IMAGE_URL_LENGTH:
            source_url = url
        else:
            inline = js_string(item.get("dataUrl")).strip()
            if not inline or js_len(inline) >= MAX_INLINE_IMAGE_LENGTH or not _INLINE_IMAGE.match(inline):
                continue
            source_url = inline

        images.append(
            NormalizedImage(
                id=identifier,
                url=source_url,
                width=_dimension(item.get("width")),
                height=_dimension(item.get("height")),
                context=_clean_context(item.get("context")),
            )
        )
    return images


def normalize_results(payload: Any) -> list[NormalizedResult]:
    """Accepted result cards, in order. Ids are preserved — see semantic.bounded_ids."""
    source = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(source, list):
        return []

    results: list[NormalizedResult] = []
    for item in source[:MAX_RESULTS]:
        if not isinstance(item, dict):
            continue
        identifier = js_string(item.get("id")).strip()
        text = js_truncate(js_string(item.get("text")).strip(), MAX_RESULT_TEXT_LENGTH)
        if not identifier or js_len(text) < MIN_RESULT_TEXT_LENGTH:
            continue
        results.append(NormalizedResult(id=identifier, text=text))
    return results


def request_rule_terms(payload: Any) -> list[str]:
    """Rule terms the extension says it is enforcing.

    Honoured only under the development auth bypass. With real authentication the stored
    policy is the authority and this list is ignored — a client must not be able to name
    what the server checks for.
    """
    source = payload.get("rules") if isinstance(payload, dict) else None
    if not isinstance(source, list):
        return []

    seen: set[str] = set()
    terms: list[str] = []
    for value in source:
        if not isinstance(value, str):
            continue
        import unicodedata

        term = js_lower(unicodedata.normalize("NFC", value).strip())
        if not MIN_RULE_TERM_LENGTH <= js_len(term) <= MAX_RULE_TERM_LENGTH or term in seen:
            continue
        seen.add(term)
        terms.append(term)
        if len(terms) == MAX_RULE_TERMS:
            break
    return terms
