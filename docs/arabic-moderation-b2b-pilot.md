# Arabic Moderation API — B2B Pilot Plan

## Decision

Treat the Chrome extension as a **credible product demonstration**, not the primary commercial motion. The near-term offer is a server-to-server Arabic text-moderation pilot for products with user-generated content. Do not sell a self-serve subscription, promise accuracy metrics, or claim dialect superiority until the pilot has reviewed customer data and measured outcomes.

## Ideal first pilot

| Dimension | Pilot constraint |
|---|---|
| Buyer | Founder, product lead, trust-and-safety lead, or engineering lead at an Arabic-first community, marketplace, game, social, or support product. |
| Problem | Human moderators spend time triaging Arabic content, customer policy changes are slow, or a review queue lacks clear contextual rationale. |
| Scope | One content surface, one policy revision, one integration endpoint, and a manual fallback review queue. |
| Data | Customer-authorized, minimized text examples; no automatic use for training. |
| Success signal | The buyer agrees the labels and `unavailable` behavior fit their workflow after a reviewed sample; no false precision target is stated before baseline data exists. |
| Commercial model | Pilot SOW/invoice or bank transfer after mutual scope agreement; metered self-service pricing is deferred. |

## First 30 conversations

Build a list manually from operators already responsible for Arabic UGC. The first outreach is a request to learn, not a claim that the model solves moderation. Ask for a 20-minute workflow interview with a concrete sample of their existing review process.

> "We built a small Arabic-first moderation API that returns customer-defined labels, confidence, and an explicit unavailable state. We are not looking to replace your moderators. Could we understand one Arabic review queue and test whether the API could reduce triage work under your policy?"

Record only: content type, current workflow, languages/dialects, unacceptable errors, policy-change frequency, human-review path, integration constraints, and whether the team would evaluate a bounded pilot. Do not retain unapproved content samples.

## Pilot sequence

First, use the developer portal to create one 5-request/minute key and test the customer’s rules against a small, reviewed sample. Then define a written evaluation sheet: expected decision, expected customer-rule label, acceptable action, human reviewer outcome, and `unavailable` handling. Only after that sheet is reviewed should the pilot key be raised, a paid invoice be discussed, or image moderation be considered.

## What not to do

Do not lead with browser filtering or comparison claims against consumer parental-control products. Do not offer an accuracy percentage, dialect benchmark, false-positive rate, automated enforcement, or fine-tuned model without reviewed evidence. Do not activate self-serve pricing or payment collection during this validation phase.
