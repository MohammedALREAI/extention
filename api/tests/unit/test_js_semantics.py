"""The UTF-16 boundary between the Node contract and the Python port.

Every assertion here was checked against Node's actual behaviour. These are not
guesses about what JavaScript does; they are what it does.
"""

import re

from contentfirewall.domain.jsc import (
    JS_WORD_BOUNDARY_FLAGS,
    js_len,
    js_lower,
    js_slice,
    js_truncate,
)

GRINNING = "\U0001f600"  # U+1F600, one code point, two UTF-16 code units
FAMILY = "\U0001f468‍\U0001f469‍\U0001f467"  # 5 code points, 8 code units


class TestJsLen:
    def test_counts_code_units_not_code_points(self) -> None:
        assert js_len("abc") == 3
        assert len(GRINNING) == 1 and js_len(GRINNING) == 2
        assert len(FAMILY) == 5 and js_len(FAMILY) == 8

    def test_bmp_characters_count_once_in_any_script(self) -> None:
        # Arabic, Japanese and Cyrillic all sit inside the BMP, so the two counts agree.
        assert js_len("كلب") == len("كلب") == 3
        assert js_len("ギャンブル") == len("ギャンブル") == 5

    def test_the_id_bound_that_silently_drops_an_image(self) -> None:
        # extensionSemanticApi.ts:143 rejects an id longer than 120 code units, and a
        # rejected image is dropped from the batch with no error. 60 emoji are 60 code
        # points — which a naive port would accept — but 120 code units, which is the
        # boundary, and 61 puts it over.
        assert js_len(GRINNING * 60) == 120
        assert js_len(GRINNING * 61) == 122
        assert len(GRINNING * 61) == 61  # what a naive port would have measured


class TestJsSlice:
    def test_matches_python_slicing_when_no_astral_characters(self) -> None:
        assert js_truncate("hello world", 5) == "hello"
        assert js_truncate("كلب وقطة", 3) == "كلب"
        assert js_truncate("short", 99) == "short"
        assert js_truncate("", 5) == ""

    def test_an_emoji_consumes_two_units_of_the_budget(self) -> None:
        # "ab😀cd" is 6 code units. Taking 4 gets "ab" plus the whole emoji.
        assert js_truncate(f"ab{GRINNING}cd", 4) == f"ab{GRINNING}"
        # Taking 5 additionally gets "c".
        assert js_truncate(f"ab{GRINNING}cd", 5) == f"ab{GRINNING}c"

    def test_a_cut_through_a_surrogate_pair_drops_the_partial_character(self) -> None:
        # JavaScript yields "ab\ud83d" here — a lone surrogate that cannot be encoded to
        # UTF-8. We drop it instead, which is one character shorter and always valid.
        result = js_truncate(f"ab{GRINNING}cd", 3)
        assert result == "ab"
        assert result.encode("utf-8")  # the JS result would raise here

    def test_start_offset(self) -> None:
        assert js_slice(f"{GRINNING}xy", 2) == "xy"
        assert js_slice("abcdef", 2, 4) == "cd"

    def test_truncation_never_exceeds_the_bound_it_was_given(self) -> None:
        for limit in range(0, 12):
            for text in ("plain text", f"a{GRINNING}b{GRINNING}c", FAMILY, "كلب كلاب"):
                assert js_len(js_truncate(text, limit)) <= limit


class TestJsLower:
    def test_is_lower_not_casefold(self) -> None:
        # str.casefold() gives "strasse" and "fi"; JavaScript's toLocaleLowerCase() does
        # neither. These strings become cache keys and rule terms.
        assert js_lower("STRASSE") == "strasse"
        assert js_lower("ß") == "ß" != "ß".casefold()
        assert js_lower("ﬁ") == "ﬁ" != "ﬁ".casefold()

    def test_leaves_scripts_without_case_alone(self) -> None:
        assert js_lower("كلب") == "كلب"
        assert js_lower("ギャンブル") == "ギャンブル"


class TestWordBoundaryFlags:
    def test_python_default_boundary_is_unicode_aware_and_javascript_is_not(self) -> None:
        # firewall.ts:39 strips English noise words with \b. In JavaScript \b only sees
        # [A-Za-z0-9_] as word characters, so "or" inside "naïve or" behaves differently
        # from Python's default. This is the flag that restores JS behaviour.
        pattern_js = re.compile(r"\bor\b", JS_WORD_BOUNDARY_FLAGS)
        pattern_py = re.compile(r"\bor\b")

        # "café" ends in a non-ASCII letter. To JavaScript that letter is a non-word
        # character, so a boundary exists between it and a following "or" written without
        # a space; to Python it does not.
        assert pattern_js.search("caféor") is not None
        assert pattern_py.search("caféor") is None

    def test_both_agree_on_plain_ascii(self) -> None:
        for pattern in (re.compile(r"\bor\b", JS_WORD_BOUNDARY_FLAGS), re.compile(r"\bor\b")):
            assert pattern.search("cats or dogs") is not None
            assert pattern.search("corn") is None
