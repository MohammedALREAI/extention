import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccessStatusCard, accountCopy, subscriptionTone, type SubscriptionView } from "./Account";

const common = {
  trialStartedAt: new Date("2026-08-20T00:00:00.000Z"),
  trialEndsAt: new Date("2026-08-30T00:00:00.000Z"),
  currentPeriodStart: null,
  currentPeriodEnd: null,
  priceCents: null,
  currency: null,
  billingPeriod: null,
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  paymentSetupRequired: true,
} satisfies Omit<SubscriptionView, "accountType" | "status" | "planCode" | "hasAccess" | "daysRemaining">;

describe("account subscription presentation", () => {
  it("covers every required server subscription state with a visible label", () => {
    expect(Object.keys(accountCopy.en)).toContain("free_trial");
    expect(Object.keys(accountCopy.en)).toContain("monthly_subscription");
    expect(Object.keys(accountCopy.en)).toContain("yearly_subscription");
    expect(Object.keys(accountCopy.en)).toContain("expired_no_subscription");
    expect(["trial", "active", "expired", "cancelled"].map(status => accountCopy.en[status as keyof typeof accountCopy.en])).not.toContain(undefined);
  });

  it("maps trial, active, expired, and cancelled states to distinct access treatment", () => {
    expect(subscriptionTone("trial")).toBe("trial");
    expect(subscriptionTone("active")).toBe("active");
    expect(subscriptionTone("expired")).toBe("expired");
    expect(subscriptionTone("cancelled")).toBe("cancelled");
  });

  it("renders plan, status, remaining access, and expiry for trial, paid, cancelled, and expired accounts", () => {
    const cases: Array<[SubscriptionView, string[]]> = [
      [{ ...common, accountType: "free_trial", status: "trial", planCode: "trial", hasAccess: true, daysRemaining: 5 }, ["Free Trial", "Trial", "5 days remaining", "Trial ends"]],
      [{ ...common, accountType: "monthly_subscription", status: "active", planCode: "monthly", hasAccess: true, daysRemaining: 28, currentPeriodEnd: new Date("2026-09-20T00:00:00.000Z"), priceCents: 1000, currency: "USD", billingPeriod: "month" }, ["Monthly Subscription", "Active", "28 days remaining", "$10 / month"]],
      [{ ...common, accountType: "yearly_subscription", status: "cancelled", planCode: "yearly", hasAccess: true, daysRemaining: 300, currentPeriodEnd: new Date("2027-08-20T00:00:00.000Z"), priceCents: 5000, currency: "USD", billingPeriod: "year", cancelAtPeriodEnd: true }, ["Yearly Subscription", "Cancelled", "300 days remaining", "Cancellation keeps access"]],
      [{ ...common, accountType: "expired_no_subscription", status: "expired", planCode: "none", hasAccess: false, daysRemaining: 0 }, ["Expired / No Subscription", "Expired", "Your access has expired.", "Choose a plan"]],
    ];

    cases.forEach(([subscription, expected]) => {
      const html = renderToStaticMarkup(createElement(AccessStatusCard, { subscription, language: "en" }));
      expected.forEach(text => expect(html).toContain(text));
    });
  });
});
