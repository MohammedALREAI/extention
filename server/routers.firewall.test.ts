import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  createPolicyForUser: vi.fn(),
  listCheckHistoryForUser: vi.fn(),
  listPoliciesForUser: vi.fn(),
  recordCheckForUser: vi.fn(),
  updatePolicyForUser: vi.fn(),
}));

vi.mock("./subscriptionService", () => ({
  getSubscriptionSummaryForUser: vi.fn().mockResolvedValue({ hasAccess: true, status: "trial" }),
}));

import { recordCheckForUser } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const user = {
  id: 7,
  openId: "firewall-test-user",
  name: "Firewall Tester",
  email: "tester@example.com",
  loginMethod: "manus",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function context(): TrpcContext {
  return {
    user,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("firewall tRPC procedures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses a preference through the typed API", async () => {
    const caller = appRouter.createCaller(context());
    const result = await caller.firewall.parsePreference({ preference: "لا أريد عنف أو قمار" });
    expect(result.language).toBe("ar");
    expect(result.rules.map(rule => rule.term)).toEqual(["عنف", "قمار"]);
  });

  it("records an authenticated check with its evaluated result", async () => {
    const caller = appRouter.createCaller(context());
    const result = await caller.firewall.evaluate({
      rules: [{ term: "gambling", action: "block" }],
      scope: { text: true, images: true },
      inputType: "text",
      value: "A gambling offer",
    });

    expect(result.decision).toBe("block");
    expect(recordCheckForUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: user.id,
      inputType: "text",
      inputValue: "A gambling offer",
      result: expect.objectContaining({ decision: "block" }),
    }));
  });
});
