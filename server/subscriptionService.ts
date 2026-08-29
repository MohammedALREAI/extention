import type { User } from "../drizzle/schema";
import { SUBSCRIPTION_PLANS, addTrialDays, daysRemainingUntil, type SubscriptionPlanCode, type SubscriptionStatus } from "../shared/subscription";
import { billingProvider, type BillingProviderId } from "./billingProvider";
import { ensureTrialSubscriptionForUser, getSubscriptionForUser, updateSubscriptionStatusForUser } from "./db";

export type SubscriptionSummary = {
  accountType: "free_trial" | "monthly_subscription" | "yearly_subscription" | "expired_no_subscription";
  status: SubscriptionStatus;
  planCode: SubscriptionPlanCode;
  hasAccess: boolean;
  daysRemaining: number;
  trialStartedAt: Date;
  trialEndsAt: Date;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  priceCents: number | null;
  currency: "USD" | null;
  billingPeriod: "month" | "year" | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  paymentSetupRequired: boolean;
  billingProvider: BillingProviderId;
  billingAvailable: boolean;
};

function accountTypeFor(planCode: string, hasAccess: boolean): SubscriptionSummary["accountType"] {
  if (!hasAccess) return "expired_no_subscription";
  if (planCode === "monthly") return "monthly_subscription";
  if (planCode === "yearly") return "yearly_subscription";
  return "free_trial";
}

export async function getSubscriptionSummaryForUser(user: Pick<User, "id" | "createdAt">, now = new Date()): Promise<SubscriptionSummary> {
  const trialStartedAt = user.createdAt;
  const trialEndsAt = addTrialDays(trialStartedAt);
  let subscription = await ensureTrialSubscriptionForUser(user.id, trialStartedAt, trialEndsAt);
  if (!subscription) subscription = await getSubscriptionForUser(user.id);
  if (!subscription) throw new Error("Subscription entitlement is unavailable.");

  const currentEnd = subscription.currentPeriodEnd;
  const activePaidPeriod = (subscription.status === "active" || subscription.status === "cancelled") && !!currentEnd && currentEnd > now;
  const activeTrial = subscription.status === "trial" && subscription.trialEndsAt > now;
  const hasAccess = activeTrial || activePaidPeriod;
  const desiredStatus: SubscriptionStatus = hasAccess
    ? (subscription.status === "trial" ? "trial" : subscription.status)
    : "expired";

  if (subscription.status !== desiredStatus) {
    await updateSubscriptionStatusForUser(subscription.userId, desiredStatus);
    subscription = { ...subscription, status: desiredStatus };
  }

  const planCode = subscription.planCode as SubscriptionPlanCode;
  const paidPlan = planCode === "monthly" || planCode === "yearly"
    ? SUBSCRIPTION_PLANS[planCode]
    : null;
  const accessEnd = paidPlan ? subscription.currentPeriodEnd : subscription.trialEndsAt;

  return {
    accountType: accountTypeFor(planCode, hasAccess),
    status: desiredStatus,
    planCode: planCode === "monthly" || planCode === "yearly" || planCode === "trial" ? planCode : "none",
    hasAccess,
    daysRemaining: daysRemainingUntil(accessEnd, now),
    trialStartedAt: subscription.trialStartedAt,
    trialEndsAt: subscription.trialEndsAt,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    priceCents: paidPlan?.amountCents ?? null,
    currency: paidPlan?.currency ?? null,
    billingPeriod: paidPlan?.billingPeriod ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    cancelledAt: subscription.cancelledAt,
    paymentSetupRequired: !paidPlan && !billingProvider.capabilities.checkout,
    billingProvider: billingProvider.id,
    billingAvailable: billingProvider.capabilities.checkout,
  };
}
