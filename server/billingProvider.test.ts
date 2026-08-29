import { describe, expect, it } from "vitest";
import { createDisabledBillingProvider } from "./billingProvider";

describe("disabled BillingProvider", () => {
  it("exposes no live billing capability and never fabricates a checkout, portal, or webhook event", async () => {
    const provider = createDisabledBillingProvider();
    expect(provider).toMatchObject({ id: "disabled", capabilities: { checkout: false, customerPortal: false, webhooks: false } });
    await expect(provider.createCheckout({ userId: 1, planCode: "monthly", successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" })).resolves.toMatchObject({ available: false, code: "provider_not_configured" });
    await expect(provider.createCustomerPortal({ userId: 1, returnUrl: "https://app.test/account" })).resolves.toMatchObject({ available: false, code: "provider_not_configured" });
    await expect(provider.parseWebhook({ headers: {}, rawBody: "{}" })).resolves.toMatchObject({ available: false, code: "provider_not_configured" });
  });
});
