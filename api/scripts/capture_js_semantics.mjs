/**
 * Records what Node actually does with the string operations the frozen contracts use,
 * into a fixture the Python suite asserts against.
 *
 *   node api/scripts/capture_js_semantics.mjs
 *
 * The Python port of these bounds cannot be checked by reasoning about UTF-16 — it has to
 * be checked against the runtime that defined them. Re-run this only when adding a case;
 * a diff in the committed fixture means the contract moved.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const SAMPLES = [
  "",
  "hello world",
  "كلب وقطة",
  "ギャンブル",
  "café",
  "caféor",
  "STRASSE",
  "ß",
  "ﬁ",
  "\u{1F600}",
  "ab\u{1F600}cd",
  "a\u{1F600}b\u{1F600}c",
  "\u{1F468}‍\u{1F469}‍\u{1F467}",
  "\u{1F600}".repeat(60),
  "\u{1F600}".repeat(61),
  "\u{20000}\u{20001}",
  "mixed كلب \u{1F600} text",
];

const LIMITS = [0, 1, 2, 3, 4, 5, 8, 80, 120, 200];

const cases = SAMPLES.map(value => ({
  value,
  length: value.length,
  codePoints: [...value].length,
  lower: value.toLocaleLowerCase(),
  slices: Object.fromEntries(LIMITS.map(limit => {
    const sliced = value.slice(0, limit);
    // A slice can cut a surrogate pair and leave a lone surrogate. Record whether it did,
    // because that is the one case where the Python port deliberately differs.
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(sliced);
    return [limit, { text: lone ? null : sliced, length: sliced.length, loneSurrogate: lone }];
  })),
}));

const out = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "js_semantics.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ node: process.version, cases }, null, 2)}\n`, "utf8");
console.log(`wrote ${cases.length} cases x ${LIMITS.length} limits -> ${out}`);
