import { describe, expect, it } from "vitest";
import { buildReport } from "../scripts/eval_images.mjs";

describe("image evaluation runner", () => {
  it("computes reviewed detection and latency metrics without image bytes", () => {
    const report = buildReport({
      schema: "content-firewall-image-eval/v1", id: "reviewed-fixture", reviewed: true, reviewedBy: "reviewer", reviewedAt: "2026-08-24",
      cases: [
        { id: "target", category: "category-a", expectedBoxes: [{ x: 100, y: 100, width: 300, height: 300 }], actual: { boxes: [{ x: 110, y: 110, width: 290, height: 290 }], latencyMs: 100, costUsd: 0.01 } },
        { id: "negative", category: "category-a", expectedBoxes: [], actual: { boxes: [], latencyMs: 300, costUsd: 0.01 } },
      ],
    }, "2026-08-24T00:00:00.000Z");
    expect(report.metrics).toMatchObject({ precision: 1, recall: 1, missedDetectionRate: 0, falsePositiveRate: 0, latencyMs: { p50: 100, p95: 300 }, costUsdPer100Results: 1 });
  });

  it("rejects unreviewed or pixel-containing data instead of creating a pretend baseline", () => {
    expect(() => buildReport({ schema: "content-firewall-image-eval/v1", reviewed: false, cases: [] })).toThrow(/reviewed/i);
    expect(() => buildReport({ schema: "content-firewall-image-eval/v1", reviewed: true, reviewedBy: "reviewer", cases: [{ id: "bad", category: "x", imageBytes: "abc", expectedBoxes: [], actual: { boxes: [], latencyMs: 1 } }] })).toThrow(/image bytes/i);
  });
});
