import { describe, expect, it } from "vitest";
import { createPaddleProvider, validatePaddleConfiguration } from "./paddleProvider";

describe("Paddle BillingProvider preparation", () => {
  it("requires only server-side credentials, both price IDs, and an explicit payout confirmation before it can be considered ready", () => {
    expect(validatePaddleConfiguration({ apiKey: "test" })).toEqual({ ready: false, missing: ["PADDLE_WEBHOOK_SECRET", "PADDLE_MONTHLY_PRICE_ID", "PADDLE_YEARLY_PRICE_ID", "PADDLE_MERCHANT_PAYOUT_CONFIRMED"] });
    expect(validatePaddleConfiguration({ apiKey: "test", webhookSecret: "whsec", monthlyPriceId: "pri_month", yearlyPriceId: "pri_year", merchantPayoutConfirmed: "confirmed" })).toEqual({ ready: true });
  });

  it("stays collection-disabled even with complete configuration until activation work is explicitly implemented", async () => {
    const provider = createPaddleProvider({ apiKey: "test", webhookSecret: "whsec", monthlyPriceId: "pri_month", yearlyPriceId: "pri_year", merchantPayoutConfirmed: "confirmed" });
    expect(provider).toMatchObject({ id: "paddle", capabilities: { checkout: false, customerPortal: false, webhooks: false } });
    await expect(provider.createCheckout({ userId: 1, planCode: "yearly", successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" })).resolves.toMatchObject({ available: false, code: "provider_not_configured" });
  });
});
