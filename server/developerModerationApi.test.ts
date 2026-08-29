import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ getActiveDeveloperApiKeyByHash: vi.fn(), touchDeveloperApiKey: vi.fn(), recordDeveloperApiUsage: vi.fn() }));
const moderation = vi.hoisted(() => ({ moderateDeveloperText: vi.fn() }));
vi.mock("./db", () => db);
vi.mock("./developerModeration", async importOriginal => ({ ...(await importOriginal<typeof import("./developerModeration")>()), ...moderation }));

import { allowDeveloperRequest, parseDeveloperModerationRequest, registerDeveloperModerationApi, usageMetrics } from "./developerModerationApi";

function response() {
  const value: { statusCode?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  return { value, status(code: number) { value.statusCode = code; return this; }, json(body: unknown) { value.body = body; return this; }, setHeader(name: string, header: string) { value.headers[name] = header; return this; } };
}

describe("developer moderation REST API", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const body = { policy: { revision: "ar-v1", description: "قواعد المجتمع", rules: [{ label: "harassment", description: "إهانة", action: "review" }] }, items: [{ id: "a", text: "إنت غبي", language: "ar" }] };

  it("validates customer policy and unique bounded text items", () => {
    expect(parseDeveloperModerationRequest(body)).toMatchObject({ revision: "ar-v1", rules: [{ label: "harassment" }], items: [{ id: "a", language: "ar" }] });
    expect(parseDeveloperModerationRequest({ ...body, items: [{ id: "a", text: "x" }, { id: "a", text: "y" }] })).toBeUndefined();
  });

  it("requires a scoped active developer key and enforces per-key rate limiting", async () => {
    const routes = new Map<string, Function>();
    registerDeveloperModerationApi({ post: (path: string, handler: Function) => routes.set(path, handler), get: () => undefined } as never);
    db.getActiveDeveloperApiKeyByHash.mockResolvedValue({ id: 909, scopesJson: ["moderation:text"], rateLimitPerMinute: 1 });
    moderation.moderateDeveloperText.mockResolvedValue([{ id: "a", state: "no_match", action: null, labels: [], confidence: 0.8, reason: "No configured rule matched." }]);
    const handler = routes.get("/api/v1/moderate/text")!;
    const unauthorized = response();
    await handler({ header: () => undefined, body }, unauthorized);
    expect(unauthorized.value.statusCode).toBe(401);
    const first = response();
    await handler({ header: () => "Bearer cfk_test_authorized", body }, first);
    expect(first.value.body).toMatchObject({ object: "moderation.batch", policyRevision: "ar-v1" });
    const limited = response();
    await handler({ header: () => "Bearer cfk_test_authorized", body }, limited);
    expect(limited.value.statusCode).toBe(429);
  });

  it("rejects revoked or wrong-scope keys without passing content to the model", async () => {
    const routes = new Map<string, Function>();
    registerDeveloperModerationApi({ post: (path: string, handler: Function) => routes.set(path, handler), get: () => undefined } as never);
    const handler = routes.get("/api/v1/moderate/text")!;
    db.getActiveDeveloperApiKeyByHash.mockResolvedValue(undefined);
    const revoked = response();
    await handler({ header: () => "Bearer cfk_revoked", body }, revoked);
    expect(revoked.value.statusCode).toBe(401);
    db.getActiveDeveloperApiKeyByHash.mockResolvedValue({ id: 910, scopesJson: [], rateLimitPerMinute: 5 });
    const wrongScope = response();
    await handler({ header: () => "Bearer cfk_wrong_scope", body }, wrongScope);
    expect(wrongScope.value.statusCode).toBe(401);
    expect(moderation.moderateDeveloperText).not.toHaveBeenCalled();
  });

  it("returns match, no_match, and genuine unavailable states without silently allowing a failed moderation", async () => {
    const routes = new Map<string, Function>();
    registerDeveloperModerationApi({ post: (path: string, handler: Function) => routes.set(path, handler), get: () => undefined } as never);
    const handler = routes.get("/api/v1/moderate/text")!;
    db.getActiveDeveloperApiKeyByHash.mockResolvedValue({ id: 911, scopesJson: ["moderation:text"], rateLimitPerMinute: 5 });
    moderation.moderateDeveloperText.mockResolvedValue([
      { id: "match", state: "match", action: "review", labels: ["harassment"], confidence: 0.92, reason: "Clear insult." },
      { id: "clean", state: "no_match", action: null, labels: [], confidence: 0.85, reason: "No configured rule matched." },
      { id: "failed", state: "unavailable", action: null, labels: [], confidence: 0, reason: "Moderation evaluation was unavailable." },
    ]);
    const multiBody = { ...body, items: [{ id: "match", text: "إنت غبي" }, { id: "clean", text: "مرحبا" }, { id: "failed", text: "تعذر التحليل" }] };
    const output = response();
    await handler({ header: () => "Bearer cfk_contract", body: multiBody }, output);
    expect(output.value.body).toMatchObject({ object: "moderation.batch", policyRevision: "ar-v1", results: [{ id: "match", state: "match", action: "review" }, { id: "clean", state: "no_match", action: null }, { id: "failed", state: "unavailable", action: null, confidence: 0 }] });
  });

  it("records only aggregate outcomes and latency, never submitted text, policies, labels, or model rationale", async () => {
    const routes = new Map<string, Function>();
    registerDeveloperModerationApi({ post: (path: string, handler: Function) => routes.set(path, handler), get: () => undefined } as never);
    db.getActiveDeveloperApiKeyByHash.mockResolvedValue({ id: 912, scopesJson: ["moderation:text"], rateLimitPerMinute: 5 });
    moderation.moderateDeveloperText.mockResolvedValue([{ id: "a", state: "match", action: "review", labels: ["harassment"], confidence: 0.93, reason: "A private rationale that must not be logged." }]);
    const handler = routes.get("/api/v1/moderate/text")!;
    await handler({ header: () => "Bearer cfk_usage", body }, response());
    await Promise.resolve();
    const telemetry = db.recordDeveloperApiUsage.mock.calls[0][0];
    expect(telemetry).toMatchObject({ apiKeyId: 912, itemCount: 1, matchCount: 1, noMatchCount: 0, unavailableCount: 0, httpStatus: 200 });
    expect(JSON.stringify(telemetry)).not.toContain("إنت غبي");
    expect(JSON.stringify(telemetry)).not.toContain("private rationale");
    expect(JSON.stringify(telemetry)).not.toContain("harassment");
  });

  it("aggregates safe outcome states and clamps latency without accepting content fields", () => {
    const metrics = usageMetrics([{ state: "match" }, { state: "no_match" }, { state: "unavailable" }], 3, 100_000);
    expect(metrics).toEqual({ itemCount: 3, matchCount: 1, noMatchCount: 1, unavailableCount: 1, latencyMs: 60_000, httpStatus: 200 });
    expect(Object.keys(metrics)).not.toContain("text");
    expect(Object.keys(metrics)).not.toContain("reason");
  });

  it("keeps the standalone rate limiter deterministic per API key", () => {
    expect(allowDeveloperRequest(17001, 1)).toBe(true);
    expect(allowDeveloperRequest(17001, 1)).toBe(false);
    expect(allowDeveloperRequest(17002, 1)).toBe(true);
  });
});
