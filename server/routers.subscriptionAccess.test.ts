import { describe, expect, it, vi } from "vitest";

const subscription = vi.hoisted(() => ({ getSubscriptionSummaryForUser: vi.fn() }));
const db = vi.hoisted(() => ({ listPoliciesForUser: vi.fn(), getDeveloperApiUsageSummaryForUser: vi.fn() }));

vi.mock("./subscriptionService", () => subscription);
vi.mock("./db", () => ({
  ...db,
  createPolicyForUser: vi.fn(),
  getPolicyByIdForUser: vi.fn(),
  listCheckHistoryForUser: vi.fn(),
  recordCheckForUser: vi.fn(),
  updatePolicyForUser: vi.fn(),
  createDeveloperApiKey: vi.fn(),
  listDeveloperApiKeysForUser: vi.fn(),
  revokeDeveloperApiKey: vi.fn(),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const user = {
  id: 21,
  openId: "subscription-test-user",
  name: "Subscription Tester",
  email: "subscription@example.com",
  loginMethod: "manus",
  role: "user" as const,
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function context(): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

function adminContext(): TrpcContext {
  return { user: { ...user, role: "admin" }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("paid firewall access", () => {
  it("allows protected policy access during an active trial", async () => {
    subscription.getSubscriptionSummaryForUser.mockResolvedValue({ hasAccess: true, status: "trial" });
    db.listPoliciesForUser.mockResolvedValue([]);
    const caller = appRouter.createCaller(context());
    await expect(caller.firewall.policies.list()).resolves.toEqual([]);
  });

  it("blocks every paid firewall route from the server after trial expiry", async () => {
    subscription.getSubscriptionSummaryForUser.mockResolvedValue({ hasAccess: false, status: "expired" });
    const caller = appRouter.createCaller(context());
    const paidCalls = [
      caller.firewall.policies.list(),
      caller.firewall.policies.create({ name: "Blocked policy", sourcePreference: "Hide gambling content", language: "en", action: "block", scope: { text: true, images: true }, rules: [{ term: "gambling", action: "block" }] }),
      caller.firewall.policies.update({ id: 1, name: "Blocked policy", sourcePreference: "Hide gambling content", language: "en", action: "block", scope: { text: true, images: true }, rules: [{ term: "gambling", action: "block" }] }),
      caller.firewall.policies.extensionAccess({ id: 1 }),
      caller.firewall.history(),
      caller.firewall.evaluate({ rules: [{ term: "gambling", action: "block" }], scope: { text: true, images: true }, inputType: "text", value: "A gambling offer" }),
    ];
    for (const paidCall of paidCalls) {
      await expect(paidCall).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    }
  });

  it("keeps preference parsing as an explicit free route even after trial expiry", async () => {
    subscription.getSubscriptionSummaryForUser.mockResolvedValue({ hasAccess: false, status: "expired" });
    const caller = appRouter.createCaller(context());
    await expect(caller.firewall.parsePreference({ preference: "I do not want gambling content" })).resolves.toMatchObject({ language: "en" });
  });

  it("exposes metadata-only developer usage to the owner, not ordinary users", async () => {
    db.getDeveloperApiUsageSummaryForUser.mockResolvedValue([{ apiKeyId: 7, label: "pilot", keyPrefix: "cfk_demo", requestCount: 4, itemCount: 9, matchCount: 2, noMatchCount: 6, unavailableCount: 1, avgLatencyMs: 412 }]);
    const owner = appRouter.createCaller(adminContext());
    const summary = await owner.developer.usage();
    expect(summary).toEqual([{ apiKeyId: 7, label: "pilot", keyPrefix: "cfk_demo", requestCount: 4, itemCount: 9, matchCount: 2, noMatchCount: 6, unavailableCount: 1, avgLatencyMs: 412 }]);
    expect(JSON.stringify(summary)).not.toMatch(/text|reason|phrase|description/i);
    const ordinaryUser = appRouter.createCaller(context());
    await expect(ordinaryUser.developer.usage()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
