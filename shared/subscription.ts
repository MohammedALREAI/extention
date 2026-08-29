export const TRIAL_LENGTH_DAYS = 10;

export type SubscriptionPlanCode = "trial" | "monthly" | "yearly" | "none";
export type SubscriptionStatus = "trial" | "active" | "expired" | "cancelled";

export const SUBSCRIPTION_PLANS: Record<Exclude<SubscriptionPlanCode, "trial" | "none">, {
  code: "monthly" | "yearly";
  name: string;
  amountCents: number;
  currency: "USD";
  billingPeriod: "month" | "year";
}> = {
  monthly: { code: "monthly", name: "Monthly Plan", amountCents: 1000, currency: "USD", billingPeriod: "month" },
  yearly: { code: "yearly", name: "Yearly Plan", amountCents: 5000, currency: "USD", billingPeriod: "year" },
};

export function addTrialDays(start: Date) {
  return new Date(start.getTime() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000);
}

export function daysRemainingUntil(end: Date | null | undefined, now = new Date()) {
  if (!end) return 0;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}
