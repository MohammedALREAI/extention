"""Holds the Python port to what Node actually did, not to what UTF-16 ought to mean.

The fixture is produced by ``api/scripts/capture_js_semantics.mjs`` running against the
real Node runtime. If this file fails, either the port drifted or the contract moved —
and either way it is not a test to loosen.
"""

import json
from pathlib import Path

import pytest

from contentfirewall.domain.jsc import js_len, js_lower, js_truncate

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "js_semantics.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = DATA["cases"]


def case_id(case: dict) -> str:
    return repr(case["value"])[:40]


@pytest.mark.parametrize("case", CASES, ids=case_id)
def test_length_matches_node(case: dict) -> None:
    assert js_len(case["value"]) == case["length"]


@pytest.mark.parametrize("case", CASES, ids=case_id)
def test_lowercase_matches_node(case: dict) -> None:
    assert js_lower(case["value"]) == case["lower"]


@pytest.mark.parametrize("case", CASES, ids=case_id)
def test_truncation_matches_node(case: dict) -> None:
    for limit_text, expected in case["slices"].items():
        limit = int(limit_text)
        actual = js_truncate(case["value"], limit)

        if expected["loneSurrogate"]:
            # The one documented divergence: Node produced an unencodable lone surrogate,
            # we drop the partial character. The result must be exactly one code unit
            # shorter, and must be encodable.
            assert js_len(actual) == expected["length"] - 1
            actual.encode("utf-8")
        else:
            assert actual == expected["text"], f"limit={limit}"
            assert js_len(actual) == expected["length"]


def test_the_fixture_actually_exercises_the_divergent_path() -> None:
    # A cross-check that never hits the surrogate-splitting case would prove nothing about
    # the only place the two implementations disagree on purpose.
    split = [
        (case["value"], limit)
        for case in CASES
        for limit, entry in case["slices"].items()
        if entry["loneSurrogate"]
    ]
    assert split, "fixture no longer covers a slice that cuts a surrogate pair"


def test_the_fixture_covers_the_120_unit_id_boundary() -> None:
    lengths = {case["length"] for case in CASES}
    assert 120 in lengths and 122 in lengths
