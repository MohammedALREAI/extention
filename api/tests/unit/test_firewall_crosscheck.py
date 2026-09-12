"""Holds the Python firewall to what the TypeScript firewall actually produced.

960 cases across Arabic, English, mixed script, emoji and every scope combination, run
through ``server/firewall.ts`` and recorded by ``capture_firewall_golden.mjs``.

This file exists because of two differences that no amount of reading the code would
surface: JavaScript's ``\\b`` is ASCII-only while Python's is Unicode-aware, and the two
languages disagree about what counts as whitespace at the edges. Both feed the cache key
and the extracted rule terms.
"""

import json
from pathlib import Path

import pytest

from contentfirewall.domain.firewall import evaluate_check, parse_preference
from contentfirewall.domain.models import (
    CacheStatus,
    FirewallRule,
    FirewallScope,
    InputType,
    PolicyAction,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "firewall_golden.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))


def parse_id(case: dict) -> str:
    return f"{case['preference'][:28]!r}|{case['requestedAction']}"


def check_id(case: dict) -> str:
    terms = ",".join(rule["term"] for rule in case["rules"]) or "-"
    scope = f"t{int(case['scope']['text'])}i{int(case['scope']['images'])}"
    return f"{terms}|{case['inputType']}|{scope}|{case['value'][:20]!r}"


@pytest.mark.parametrize("case", DATA["parsed"], ids=parse_id)
def test_parse_preference_matches_typescript(case: dict) -> None:
    requested = PolicyAction(case["requestedAction"]) if case["requestedAction"] else None
    actual = parse_preference(case["preference"], requested)
    expected = case["output"]

    assert actual.language == expected["language"]
    assert str(actual.action) == expected["action"]
    assert [{"term": rule.term, "action": str(rule.action)} for rule in actual.rules] == expected["rules"]
    assert list(actual.notes) == expected["notes"]


@pytest.mark.parametrize("case", DATA["checks"], ids=check_id)
def test_evaluate_check_matches_typescript(case: dict) -> None:
    actual = evaluate_check(
        rules=[FirewallRule(term=rule["term"], action=PolicyAction(rule["action"])) for rule in case["rules"]],
        scope=FirewallScope(text=case["scope"]["text"], images=case["scope"]["images"]),
        input_type=InputType(case["inputType"]),
        value=case["value"],
    )
    expected = case["output"]

    assert str(actual.decision) == expected["decision"]
    assert actual.confidence == expected["confidence"]
    assert actual.reason == expected["reason"]
    assert list(actual.matched_terms) == expected["matchedTerms"]
    assert actual.uncertain == expected["uncertain"]
    # The domain is always FRESH — caching moved to the service layer, where a shared store
    # can make the fresh/cached answer atomic across processes instead of per-worker.
    assert actual.cache_status == CacheStatus.FRESH


def test_the_corpus_is_not_trivial() -> None:
    decisions = {case["output"]["decision"] for case in DATA["checks"]}
    assert {"allow", "blur", "block", "warn", "uncertain"} <= decisions, decisions

    parsed_term_counts = {len(case["output"]["rules"]) for case in DATA["parsed"]}
    assert 0 in parsed_term_counts and 8 in parsed_term_counts  # empty and capped both covered

    languages = {case["output"]["language"] for case in DATA["parsed"]}
    assert languages == {"ar", "en"}


def test_memoisation_was_a_process_local_concern() -> None:
    # The TS implementation answered "fresh" then "cached" for an identical repeat, from a
    # module-level Map. That map was unbounded, per-worker, and its answer was persisted to
    # check_history and returned to clients — so the same input reported differently
    # depending on which worker served it. The Python domain does not cache at all.
    assert DATA["memoisation"]["once"]["cacheStatus"] == "fresh"
    assert DATA["memoisation"]["twice"]["cacheStatus"] == "cached"
    assert DATA["memoisation"]["once"]["decision"] == DATA["memoisation"]["twice"]["decision"]
