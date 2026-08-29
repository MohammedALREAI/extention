import type { BillingProvider, BillingUnavailable } from "./billingProvider";

export type PaddleConfiguration = {
  apiKey?: string;
  webhookSecret?: string;
  monthlyPriceId?: string;
  yearlyPriceId?: string;
  merchantPayoutConfirmed?: string;
};

export type PaddleReadiness = { ready: true } | { ready: false; missing: string[] };

function present(value: string | undefined) { return Boolean(String(value || "").trim()); }

export function validatePaddleConfiguration(config: PaddleConfiguration): PaddleReadiness {
  const required: Array<[keyof PaddleConfiguration, string]> = [
    ["apiKey", "PADDLE_API_KEY"],
    ["webhookSecret", "PADDLE_WEBHOOK_SECRET"],
    ["monthlyPriceId", "PADDLE_MONTHLY_PRICE_ID"],
    ["yearlyPriceId", "PADDLE_YEARLY_PRICE_ID"],
    ["merchantPayoutConfirmed", "PADDLE_MERCHANT_PAYOUT_CONFIRMED"],
  ];
  const missing = required.filter(([key]) => !present(config[key])).map(([, env]) => env);
  return missing.length ? { ready: false, missing } : { ready: true };
}

function unavailable(readiness: PaddleReadiness): BillingUnavailable {
  const suffix = readiness.ready ? "Paddle activation remains deliberately disabled until the signed webhook lifecycle implementation is enabled." : `Missing: ${readiness.missing.join(", ")}.`;
  return { available: false, code: "provider_not_configured", message: `Paddle is not ready for collection. ${suffix}` };
}

/**
 * A configuration-aware Paddle adapter. It intentionally has no checkout,
 * portal, or webhook capability until the merchant confirms payout eligibility
 * and supplies sandbox credentials through managed project secrets.
 */
export function createPaddleProvider(config: PaddleConfiguration = {}): BillingProvider {
  const readiness = validatePaddleConfiguration(config);
  return {
    id: "paddle",
    capabilities: { checkout: false, customerPortal: false, webhooks: false },
    createCheckout: async () => unavailable(readiness),
    createCustomerPortal: async () => unavailable(readiness),
    parseWebhook: async () => unavailable(readiness),
  };
}
