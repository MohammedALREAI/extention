import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  ensureTrialSubscriptionForUser: vi.fn(),
  getSubscriptionForUser: vi.fn(),
  updateSubscriptionStatusForUser: vi.fn(),
}));

vi.mock("./db", () => db);

import { getSubscriptionSummaryForUser } from "./subscriptionService";

const user = { id: 12, createdAt: new Date("2026-08-14T12:00:00.000Z") };

describe("subscription entitlement service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a one-time ten-day trial from account activation and reports remaining access", async () => {
    db.ensureTrialSubscriptionForUser.mockResolvedValue({
      userId: user.id,
      planCode: "trial",
      status: "trial",
      trialStartedAt: user.createdAt,
      trialEndsAt: new Date("2026-08-24T12:00:00.000Z"),
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    });

    const summary = await getSubscriptionSummaryForUser(user as never, new Date("2026-08-19T12:00:00.000Z"));
    expect(db.ensureTrialSubscriptionForUser).toHaveBeenCalledWith(user.id, user.createdAt, new Date("2026-08-24T12:00:00.000Z"));
    expect(summary).toMatchObject({ accountType: "free_trial", status: "trial", hasAccess: true, daysRemaining: 5, planCode: "trial" });
  });

  it("expires access server-side once a trial has ended", async () => {
    db.ensureTrialSubscriptionForUser.mockResolvedValue({
      userId: user.id,
      planCode: "trial",
      status: "trial",
      trialStartedAt: user.createdAt,
      trialEndsAt: new Date("2026-08-24T12:00:00.000Z"),
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    });

    const summary = await getSubscriptionSummaryForUser(user as never, new Date("2026-08-25T12:00:00.000Z"));
    expect(db.updateSubscriptionStatusForUser).toHaveBeenCalledWith(user.id, "expired");
    expect(summary).toMatchObject({ accountType: "expired_no_subscription", status: "expired", hasAccess: false, daysRemaining: 0 });
  });

  it("preserves cancelled paid access until the current billing period ends", async () => {
    db.ensureTrialSubscriptionForUser.mockResolvedValue({
      userId: user.id,
      planCode: "yearly",
      status: "cancelled",
      trialStartedAt: user.createdAt,
      trialEndsAt: new Date("2026-08-24T12:00:00.000Z"),
      currentPeriodStart: new Date("2026-08-20T12:00:00.000Z"),
      currentPeriodEnd: new Date("2027-08-20T12:00:00.000Z"),
      cancelAtPeriodEnd: true,
      cancelledAt: new Date("2026-08-21T12:00:00.000Z"),
    });

    const summary = await getSubscriptionSummaryForUser(user as never, new Date("2026-08-24T12:00:00.000Z"));
    expect(summary).toMatchObject({ accountType: "yearly_subscription", status: "cancelled", hasAccess: true, priceCents: 5000, billingPeriod: "year", cancelAtPeriodEnd: true });
  });
});
