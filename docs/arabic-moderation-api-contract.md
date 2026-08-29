# Arabic Moderation API — Product Contract v1

## Positioning

Content Firewall becomes the **reference application and demo** for an API that helps Arabic-first products moderate user-generated text. The first buyers are communities, marketplaces, games, social products, and support tools that need configurable policy decisions rather than a consumer browser filter.

The API is not presented as a replacement for legal, trust-and-safety, or human-review programs. It returns a policy decision and traceable rationale so the customer can route content to allow, mask, queue, or block.

## v1 request

`POST /api/v1/moderate/text` accepts an API key and at most 20 text items per request. A customer supplies a policy revision, an Arabic or multilingual policy description, and one or more editable rules. Each rule has a durable customer label, a natural-language description, and an action of `allow`, `mask`, `review`, or `block`.

```json
{
  "policy": {
    "revision": "community-ar-v3",
    "description": "لا تسمح بإهانات أو تهديدات أو عروض احتيال في تعليقات المجتمع.",
    "rules": [
      { "label": "harassment", "description": "إهانات أو مضايقات موجهة لشخص", "action": "review" },
      { "label": "fraud", "description": "وعود أو عروض احتيالية لسرقة المال أو البيانات", "action": "block" }
    ]
  },
  "items": [{ "id": "comment-17", "text": "...", "language": "ar" }]
}
```

## v1 response and safety contract

Every item returns one of three states: `match`, `no_match`, or `unavailable`. `match` carries only the matched customer-rule label(s), requested action, confidence, and a short rationale. `no_match` is a completed evaluation that did not match a rule. `unavailable` means the model or request path could not complete; it must never be silently converted to `no_match` or `allow`.

The service returns only bounded text metadata. It does not persist full submitted content in the v1 usage log, and it never auto-trains on customer requests. Customers may later opt into a separate, rights-cleared evaluation dataset process.

## Arabic language treatment

The API accepts Arabic in Modern Standard Arabic and dialectal forms alongside mixed Arabic/English text. It does not make a dialect a category or a risk signal. The customer controls the category taxonomy and writes rules in the language that fits its community; the evaluation considers ordinary spelling variants, inflection, and clear semantic equivalence.

For example, a customer can use the stable label `harassment` with an Arabic description such as `إهانة أو تهديد أو مضايقة موجّهة لشخص، بما يشمل الصياغات الفصحى والعامية الواضحة`. A Jordanian, Egyptian, Gulf, Levantine, or mixed-script message is evaluated against that customer rule. When context is insufficient, the response must use `no_match` with low confidence only if evaluation completed, or `unavailable` if it did not; it must not invent dialect meaning.

## Image-moderation contract (separate pilot)

`POST /api/v1/moderate/image` is a separate, opt-in pilot path. It accepts no image bytes: each item contains an ID, an HTTPS image URL, optional observed width/height, and the same customer policy/rules. A completed response returns per-image state `match`, `no_match`, or `unavailable`. A `match` contains zero or more normalized 0–1000 object boxes, matching customer-rule labels, confidence, and reason. A `no_match` contains no boxes. An `unavailable` contains no boxes and must route to the customer’s review behavior.

The API does not fetch non-HTTPS URLs, does not retain source image bytes, and does not treat a failed fetch/model call as a confident no-match. This pilot remains off by default until it is evaluated on customer-authorized, reviewed examples.

## Authentication and boundaries

Developer keys use a separate `cfk_` secret, are stored only as a hash, can be labelled and revoked, and are never derived from or interchangeable with an extension policy token. The pilot applies conservative per-key rate limits. It provides no production SLA, billing, or live payment collection until a B2B contract and invoicing process are selected.

## Pilot usage metadata

The pilot may retain a metadata-only usage row after a valid API request: API-key identifier, request item count, counts of `match`, `no_match`, and `unavailable`, response status, elapsed milliseconds, and timestamp. It must not retain submitted text, language values, customer policy descriptions, rule descriptions, matched phrases, model rationales, image bytes, or source URLs. The owner dashboard displays aggregates by key only; it never displays customer content.

## Out of scope for v1

Automatic enforcement inside a customer database, organization/team management, fine-tuning claims, and paid metering are deliberately deferred. The current visual-localization feature remains a pilot until evaluated with a reviewed dataset.
