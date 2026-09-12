/**
 * Records what the TypeScript firewall actually produced, so the Python port can be held
 * to it — particularly across Arabic, English and mixed-script input, where the regex
 * flag differences between the two languages would otherwise diverge silently.
 *
 *   npx tsx api/scripts/capture_firewall_golden.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { evaluateCheck, parsePreference, resetDecisionCache } from "../../server/firewall.ts";

const PREFERENCES = [
  "I don't want to see gambling or violence",
  "I do not want to view gambling, violence and weapons",
  "please block gambling",
  "hide images of weapons",
  "blur text about alcohol",
  "warn me about spoilers",
  "show me nothing about politics",
  "the dog and a cat or an eagle",
  "gambling",
  "a",
  "",
  "   ",
  "cats, dogs, birds, fish, horses, snakes, frogs, mice, ants",  // over the 8-term cap
  "dog, dog, DOG, Dog",                                           // dedupe, case-insensitive
  "naïve café or crème brûlée",                                   // \b against non-ASCII
  "Grün und Straße",
  "لا أريد مشاهدة عنف أو قمار",
  "لا اريد ان ارى كلاب",
  "احجب القمار والعنف",
  "طمس الكلاب",
  "نبهني من مشاهدة العنف",
  "قمار، عنف، أسلحة",
  "كلب و قطة أو حصان",
  "عنف",
  "dogs و كلاب",                                                  // mixed script
  "ギャンブル",
  "暴力 or gambling",
  "🐕 and 🐈",                                                     // astral: length 2 in JS
  "🐕",                                                           // one emoji = length 2
  "I don't want to see 🐕 or 🐈",
];

const ACTIONS = [undefined, "blur", "block", "warn"];

const parsed = [];
for (const preference of PREFERENCES) {
  for (const requestedAction of ACTIONS) {
    parsed.push({
      preference,
      requestedAction: requestedAction ?? null,
      output: parsePreference(preference, requestedAction),
    });
  }
}

const RULE_SETS = [
  [],
  [{ term: "dog", action: "blur" }],
  [{ term: "dog", action: "blur" }, { term: "cat", action: "block" }],
  [{ term: "dog", action: "warn" }, { term: "cat", action: "blur" }, { term: "bird", action: "block" }],
  [{ term: "كلب", action: "blur" }],
  [{ term: "ギャンブル", action: "block" }],
  [{ term: "  Dog  ", action: "blur" }],   // normalization on the rule side
];

const VALUES = [
  "A quick guide to dog training",
  "Cats and dogs living together",
  "nothing relevant here",
  "",
  "   ",
  "DOG",
  "hotdog stand",                            // substring match is intentional
  "صور كلب جميلة",
  "ギャンブルのガイド",
  "https://example.test/photos/dog-1.jpg",
  "https://example.test/photos/landscape.jpg",
  "line one\n\nline\ttwo",                   // whitespace collapsing
  "trailing space ",
  "non breaking space",            // JS \s includes U+00A0
  "﻿leading bom",                       // JS \s includes U+FEFF, Python's does not
];

const SCOPES = [
  { text: true, images: true },
  { text: false, images: true },
  { text: true, images: false },
  { text: false, images: false },
];

const checks = [];
for (const rules of RULE_SETS) {
  for (const value of VALUES) {
    for (const inputType of ["text", "image"]) {
      for (const scope of SCOPES) {
        // The TS implementation memoises in a module-level Map, so every case starts clean
        // and the recorded cacheStatus is always "fresh". The Python port keeps caching
        // out of the domain entirely; the service decides fresh vs cached.
        resetDecisionCache();
        checks.push({
          rules,
          scope,
          inputType,
          value,
          output: evaluateCheck({ rules, scope, inputType, value }),
        });
      }
    }
  }
}

// Prove the memoisation behaviour separately rather than letting it leak into every case.
resetDecisionCache();
const once = evaluateCheck({ rules: RULE_SETS[1], scope: SCOPES[0], inputType: "text", value: "a dog" });
const twice = evaluateCheck({ rules: RULE_SETS[1], scope: SCOPES[0], inputType: "text", value: "a dog" });

const out = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "firewall_golden.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ parsed, checks, memoisation: { once, twice } }, null, 2)}\n`, "utf8");
console.log(`wrote ${parsed.length} parse cases and ${checks.length} check cases -> ${out}`);
