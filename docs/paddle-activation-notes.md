# Paddle Activation Notes

**Research status:** Prepared for a future test-mode integration; no Paddle connector, API key, webhook secret, price ID, customer ID, or live collection is configured in this repository.

Paddle models checkout collection around transactions. A future adapter should create or pass an automatic-collection transaction into Checkout using approved Paddle products/prices; subscription renewals and lifecycle changes are provider events, not client-side entitlement decisions.[^transactions]

Paddle’s hosted customer portal supports invoices, payment-method updates, and subscription management. A future adapter may create an authenticated portal session after the application maps an internal user to a verified Paddle customer ID; cancellation and payment outcomes must still arrive through signed webhooks and update the existing server-side entitlement store idempotently.[^portal]

## Preconditions before activation

| Required item | Why it is required |
|---|---|
| Written merchant onboarding and payout eligibility confirmation | Buyer-market support does not by itself prove merchant payout eligibility. |
| Sandbox API key | Server-only creation of checkout transactions and portal sessions. |
| Sandbox webhook secret | Signature verification before subscription state changes. |
| Monthly and yearly Paddle price IDs | Maps the existing $10/month and $50/year catalog to provider products. |
| Public webhook URL | Receives signed subscription lifecycle events in test mode. |
| Tested event mapping | Ensures activation, renewal, cancellation, failed payment, and refund update the entitlement record idempotently. |

[^transactions]: [Paddle — Create a transaction](https://developer.paddle.com/build/transactions/create-transaction)
[^portal]: [Paddle — Customer portal](https://developer.paddle.com/concepts/sell/customer-portal/)
