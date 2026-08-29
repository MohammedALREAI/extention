# Roadmap v2 Assessment

**Status:** Assessed on 2026-08-24. This note separates work already shipped from work that is technically ready, product-decision-bound, or externally blocked. It is not a commitment to implement every item.

## Current Baseline

The product already has a multilingual policy model, server-side entitlement gating, a Chrome MV3 extension, exact text masking, and independent visual outcomes: **match → target-only blur**, **no match → no overlay**, and **visual failure → Review for that image only**. Extension v1.0.6 additionally uses high-quality Google image sources, individual high-detail analysis, bounding-box NMS, and consent-only feedback export metadata.

## Applicability Matrix

| Roadmap module | Status | What can be applied | Dependency / recommendation |
|---|---|---|---|
| D1: self-discipline vs parental control | Product decision required | Keep the current self-discipline model without PIN, child accounts, or managed policies. | Confirm this before any parental-control work. |
| D2: primary content category | Product decision required | The product already accepts arbitrary multilingual categories. Select one primary real-world category for accuracy measurement; cats/dogs remain only technical fixtures. | A concrete category and labeling rubric are required before a meaningful evaluation set. |
| D3: Strict vs Fast protection | Ready after approval | Add a persisted Strict/Fast policy setting; Strict pre-covers image candidates at `document_start` and reveals only on a positive allow/no-match result. | Recommend Strict as the default only after confirming the acceptable false-cover/latency trade-off. |
| D4 / M3: billing | Provider decision and credentials required | Refactor the existing trial/entitlement service behind a provider-neutral billing interface now. | Do not implement a live provider until merchant onboarding, payout eligibility, webhook secret, and product IDs are available. |
| M1: measurement | Ready to scaffold, data blocked | Build the evaluation harness, labeling schema, and JSON report format. | A 300–500-image labeled set cannot be fabricated; it requires rights-cleared, human-reviewed examples and a rubric. |
| M2: leak window | Ready after D3 | Add `document_start` protection CSS, Strict/Fast setting, and time-to-protection instrumentation. | The “zero exposed frames” claim requires trace-based browser measurement on real Google Images pages. |
| M4: accuracy | Partially shipped | High-quality source selection, per-image localization, NMS, outcome-aware feedback, and release packaging are shipped. | Two-pass crop verification and calibrated thresholds should wait for M1’s real baseline, not guessed thresholds. |
| M5: cost and caching | Ready in stages | Add normalized text hashing, local pre-filter metrics, and per-user usage/cost metering. | Cross-user perceptual-hash cache requires a privacy/security design and data-retention decision. |
| M6: resilience | Ready | CI release pipeline, selector fixture tests, remote **data-only** selector configuration, offline differentiation, and latency/error telemetry can be built. | Remote configuration must never deliver executable code to the MV3 extension. |
| M7 / M8: reach and store | Later | YouTube fixtures, Chrome Store submission materials, and Edge/Firefox assessment are practical later. | Defer until M1–M3 establish measured accuracy, billing, and protection posture. |

## Recommended Execution Order

1. **Choose D1–D3 and the primary evaluation category.** Without these, strict behavior and measurement targets have no stable product definition.
2. **Build M1’s harness and labeling rubric.** Start with the runner and schema; add only reviewed, rights-cleared examples.
3. **Implement M2 Strict/Fast and M6 observability/CI.** Measure the real leak window and surface failures before adding new platforms.
4. **Calibrate M4 using the baseline.** Add crop verification only if the measured false-positive rate justifies its latency and cost.
5. **Select billing provider and implement M3.** Retain the existing one-time trial/entitlement source of truth behind the provider interface.
6. **Apply M5 metering/caching, then expand reach/store work.**

## Billing Provider Note

Stripe’s official country list does not list Palestinian territories for standard Stripe availability.[^stripe] Paddle lists Palestinian territories as a supported buyer market, but seller/payout onboarding must be confirmed separately.[^paddle] Polar’s payment documentation states global payment support subject to sanctions, while its published payout-country list must be checked against the merchant’s actual legal residence or business jurisdiction.[^polar] Therefore, **do not rely on a generic “global” claim**: obtain written onboarding and payout confirmation from the chosen Merchant of Record before changing the production billing integration.

[^stripe]: [Stripe — Global availability](https://stripe.com/global)
[^paddle]: [Paddle — Supported countries](https://developer.paddle.com/concepts/sell/supported-countries-locales)
[^polar]: [Polar — Supported countries](https://polar.sh/docs/merchant-of-record/supported-countries)
