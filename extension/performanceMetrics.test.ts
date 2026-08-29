import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => { await import("./performanceMetrics.js"); });

describe("extension performance metrics", () => {
  it("keeps bounded performance counters locally and supports reset without collecting page content", () => {
    const metrics = globalThis.CFPerformance.createPerformanceMetrics();
    metrics.record("scansStarted");
    metrics.record("cardsDeferred", 7);
    metrics.record("visualInflightJoins", 2);
    metrics.record("unknown", 99);
    expect(metrics.snapshot()).toMatchObject({ scansStarted: 1, cardsDeferred: 7, visualInflightJoins: 2 });
    expect(JSON.stringify(metrics.snapshot())).not.toMatch(/text|url|policy|content/i);
    globalThis.CFPerformance.setActive(metrics);
    expect(globalThis.CFPerformance.snapshot()).toMatchObject({ scansStarted: 1, cardsDeferred: 7 });
    metrics.reset();
    expect(metrics.snapshot()).toMatchObject({ scansStarted: 0, cardsDeferred: 0, visualInflightJoins: 0 });
  });
});
