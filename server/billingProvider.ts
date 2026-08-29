import type { SubscriptionPlanCode } from "../shared/subscription";

export type BillingProviderId = "disabled" | "paddle" | "polar" | "stripe";
export type BillingUnavailable = { available: false; code: "provider_not_configured"; message: string };
export type CheckoutSession = { available: true; url: string; providerCheckoutId: string } | BillingUnavailable;
export type CustomerPortal = { available: true; url: string } | BillingUnavailable;
export type BillingWebhookEvent = {
  providerEventId: string;
  type: "activation" | "renewal" | "cancellation" | "failed_payment" | "refund";
  userReference: string;
  planCode?: Exclude<SubscriptionPlanCode, "trial" | "none">;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
};

export interface BillingProvider {
  readonly id: BillingProviderId;
  readonly capabilities: { checkout: boolean; customerPortal: boolean; webhooks: boolean };
  createCheckout(input: { userId: number; planCode: Exclude<SubscriptionPlanCode, "trial" | "none">; successUrl: string; cancelUrl: string }): Promise<CheckoutSession>;
  createCustomerPortal(input: { userId: number; returnUrl: string }): Promise<CustomerPortal>;
  parseWebhook(input: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<BillingWebhookEvent | BillingUnavailable>;
}

const unavailable = (): BillingUnavailable => ({
  available: false,
  code: "provider_not_configured",
  message: "Billing is not configured yet. Trial and existing entitlement checks remain active.",
});

export function createDisabledBillingProvider(): BillingProvider {
  return {
    id: "disabled",
    capabilities: { checkout: false, customerPortal: false, webhooks: false },
    createCheckout: async () => unavailable(),
    createCustomerPortal: async () => unavailable(),
    parseWebhook: async () => unavailable(),
  };
}

// This is the only composition point a future Paddle, Polar, or Stripe adapter
// must replace. Subscription entitlement logic remains provider-agnostic.
export const billingProvider: BillingProvider = createDisabledBillingProvider();
