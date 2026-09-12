"""The deterministic tier: turn a free-text preference into rules, and match literally.

No model calls. This runs before anything expensive and answers the easy cases — which is
most of them — so the model only sees what actually needs judgement.

Two things here are inherited from the Node implementation and must not be "modernised":

* the regexes use ASCII word boundaries, because JavaScript's ``\\b`` is ASCII-only while
  Python's is Unicode-aware. Without the flag, ``\\bor\\b`` starts matching inside Arabic
  and accented words and silently eats part of a rule term;
* term length is measured in UTF-16 code units, because that is what the ``length >= 2``
  filter meant. A single emoji is length 2 in JavaScript and 1 in Python, so a port using
  ``len()`` drops a term the original kept.

Caching lives in the service layer, not here. ``evaluate_check`` is pure and always
reports ``FRESH``; the caller swaps in ``CACHED`` when it served the value from a store.
That keeps the fresh/cached answer atomic and consistent across processes, which a
module-level dict could never be.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Final

from contentfirewall.domain.jsc import js_len, js_lower
from contentfirewall.domain.models import (
    CacheStatus,
    CheckResult,
    Decision,
    FirewallRule,
    FirewallScope,
    InputType,
    ParsedPreference,
    PolicyAction,
)

MAX_TERMS: Final = 8
MIN_TERM_UNITS: Final = 2

MATCHED_CONFIDENCE: Final = 0.96
NO_MATCH_TEXT_CONFIDENCE: Final = 0.88
DISABLED_CONFIDENCE: Final = 1.0
UNCERTAIN_IMAGE_CONFIDENCE: Final = 0.0

# Ordered strongest first — the first group whose marker appears wins.
ACTION_MARKERS: Final[tuple[tuple[PolicyAction, tuple[str, ...]], ...]] = (
    (
        PolicyAction.BLOCK,
        ("block", "hide", "don't show", "do not show", "احجب", "اخفي", "لا أريد", "لا اريد", "ممنوع"),
    ),
    (PolicyAction.BLUR, ("blur", "obscure", "طمس", "غبش", "ضبب")),
    (PolicyAction.WARN, ("warn", "warning", "alert me", "حذر", "تحذير", "نبهني")),
)

SEVERITY: Final[dict[PolicyAction, int]] = {
    PolicyAction.BLOCK: 3,
    PolicyAction.BLUR: 2,
    PolicyAction.WARN: 1,
}

# JavaScript's \s and Python's differ at the edges: JS includes U+FEFF and excludes the
# C0 separators U+001C-U+001F, Python is the other way round. Whitespace collapsing feeds
# the cache key, so the class is spelled out rather than inherited from either default.
_JS_SPACE: Final = "\t\n\v\f\r    -     　﻿"
_WHITESPACE_RUN: Final = re.compile(f"[{_JS_SPACE}]+")

_ENGLISH_NOISE: Final = re.compile(
    r"\b(i\s+(?:do\s+not|don't)\s+want\s+to\s+(?:see|view)|please|show\s+me|block|hide|blur"
    r"|warn(?:\s+me)?|about|images?\s+of|text\s+about)\b",
    re.ASCII | re.IGNORECASE,
)
_ARABIC_NOISE: Final = re.compile(
    r"(لا\s*أريد\s*(?:أن\s*)?(?:أرى|اشوف|أشوف|مشاهدة)?"
    r"|لا\s*اريد\s*(?:ان\s*)?(?:ارى|اشوف|أشوف|مشاهدة)?"
    r"|احجب|اخفي|أخفي|طمس|غبش|حذرني|نبهني|من\s*(?:مشاهدة|رؤية))",
    re.IGNORECASE,
)

_SENTENCE_PUNCTUATION: Final = re.compile(r"[.!?؟]")
_ENGLISH_SEPARATOR: Final = re.compile(r"\s*(?:,|\band\b|\bor\b)\s*", re.ASCII | re.IGNORECASE)
_ARABIC_SEPARATOR: Final = re.compile(r"(?:\s*[،,]\s*|\s+أو\s+|\s+و\s+)")
_LEADING_ARTICLE: Final = re.compile(r"^(?:the|a|an)\s+", re.ASCII | re.IGNORECASE)
_ARABIC_RANGE: Final = re.compile(r"[؀-ۿ]")

_EMPTY_NOTE_AR: Final = "أضف موضوعاً واضحاً واحداً على الأقل، مثل: عنف أو قمار."
_EMPTY_NOTE_EN: Final = "Add at least one clear topic, such as violence or gambling."


def compact(value: str) -> str:
    """Collapse runs of whitespace and trim — the shape every comparison is made in."""
    return _WHITESPACE_RUN.sub(" ", value).strip()


def normalize(value: str) -> str:
    return compact(js_lower(value))


def detect_language(value: str) -> str:
    """Any Arabic-range character makes it Arabic. Deliberately crude and predictable."""
    return "ar" if _ARABIC_RANGE.search(value) else "en"


def infer_action(value: str) -> PolicyAction:
    lowered = js_lower(value)
    for action, markers in ACTION_MARKERS:
        if any(marker in lowered for marker in markers):
            return action
    return PolicyAction.BLUR


def extract_terms(preference: str, language: str) -> tuple[str, ...]:
    """Pull the subjects out of a sentence, dropping the words that carry no subject."""
    noise = _ARABIC_NOISE if language == "ar" else _ENGLISH_NOISE
    stripped = compact(_SENTENCE_PUNCTUATION.sub(" ", noise.sub(" ", preference)))
    separator = _ARABIC_SEPARATOR if language == "ar" else _ENGLISH_SEPARATOR

    seen: set[str] = set()
    terms: list[str] = []
    for part in separator.split(stripped):
        term = compact(_LEADING_ARTICLE.sub("", part))
        # UTF-16 code units, not code points: one emoji is length 2 in JavaScript and
        # passed this filter, and must keep passing it.
        if js_len(term) < MIN_TERM_UNITS:
            continue
        key = js_lower(term)
        if key in seen:
            continue
        seen.add(key)
        terms.append(term)
        if len(terms) == MAX_TERMS:
            break
    return tuple(terms)


def parse_preference(preference: str, requested_action: PolicyAction | None = None) -> ParsedPreference:
    """Turn "I don't want to see gambling or violence" into two editable rules.

    The user's original wording is never replaced — these rules are shown back to them to
    review and change, which is the whole reason the parse is deterministic rather than a
    model call.
    """
    language = detect_language(preference)
    action = requested_action if requested_action is not None else infer_action(preference)
    terms = extract_terms(preference, language)
    notes = () if terms else ((_EMPTY_NOTE_AR,) if language == "ar" else (_EMPTY_NOTE_EN,))
    return ParsedPreference(
        language=language,  # type: ignore[arg-type]
        action=action,
        rules=tuple(FirewallRule(term=term, action=action) for term in terms),
        notes=notes,
    )


def decision_cache_key(
    rules: Sequence[FirewallRule],
    scope: FirewallScope,
    input_type: InputType,
    value: str,
) -> str:
    """Content-addressed, and stable under rule reordering.

    Sorted so that the same policy written in a different order is the same key, which is
    what makes the cache worth having across users with identical rules.
    """
    signature = "|".join(sorted(f"{normalize(rule.term)}:{rule.action}" for rule in rules))
    return f"{signature}::{scope.text}:{scope.images}::{input_type}::{normalize(value)}"


def evaluate_check(
    *,
    rules: Sequence[FirewallRule],
    scope: FirewallScope,
    input_type: InputType,
    value: str,
) -> CheckResult:
    """Literal substring matching against the rule terms, normalized on both sides.

    The image branch is the important one: a URL that matched no rule is **uncertain**,
    not allowed. This tier cannot see pixels, so it has no basis to call an image clean,
    and saying "allow" here is how an unchecked image ends up on screen.
    """
    enabled = scope.text if input_type == InputType.TEXT else scope.images

    if not enabled:
        reason = (
            "Text checks are disabled by this policy."
            if input_type == InputType.TEXT
            else "Image URL checks are disabled by this policy."
        )
        return CheckResult(
            decision=Decision.ALLOW,
            confidence=DISABLED_CONFIDENCE,
            reason=reason,
            cache_status=CacheStatus.FRESH,
        )

    normalized_value = normalize(value)
    matched = [rule for rule in rules if normalize(rule.term) in normalized_value]

    if matched:
        strongest = max(matched, key=lambda rule: SEVERITY[rule.action])
        return CheckResult(
            decision=Decision(strongest.action),
            confidence=MATCHED_CONFIDENCE,
            reason=f"Matched rule: “{strongest.term}”.",
            cache_status=CacheStatus.FRESH,
            matched_terms=tuple(rule.term for rule in matched),
        )

    if input_type == InputType.IMAGE:
        return CheckResult(
            decision=Decision.UNCERTAIN,
            confidence=UNCERTAIN_IMAGE_CONFIDENCE,
            reason=(
                "No rule matched the URL text. This MVP does not inspect remote image "
                "pixels, so the image is not marked safe."
            ),
            cache_status=CacheStatus.FRESH,
            uncertain=True,
        )

    return CheckResult(
        decision=Decision.ALLOW,
        confidence=NO_MATCH_TEXT_CONFIDENCE,
        reason="No enabled rule matched this text.",
        cache_status=CacheStatus.FRESH,
    )
