# Verification Notes

## 2026-08-23 — Bilingual interface check

The language switch successfully changes visible interface copy between English and Arabic, applies right-to-left layout to Arabic, and keeps user-entered preference and test content intact rather than translating it unexpectedly. The preference workflow, scope controls, editable rules area, test workspace, decision space, and persistence call-to-action remain visible in both language modes.

## 2026-08-23 — Interactive rule flow check

The English preference “I don't want to see gambling or graphic violence” generates two editable rules: `gambling` and `graphic violence`. A text test containing “gambling” returns the configured blur action with 96% confidence, names the matched rule, and labels the first evaluation as fresh.

## 2026-08-23 — Uncertain image result check

An unmatched remote image URL returns `Uncertain`, explains that pixels were not inspected, reports no matching rules, and explicitly says the image was not silently treated as safe.
