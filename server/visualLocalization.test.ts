import { describe, expect, it } from "vitest";
import { parseVisualReply } from "./visualLocalization";

describe("visual object localization", () => {
  it("accepts a dog box while preserving the absence of a cat box in a mixed image", () => {
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "dog-cat", boxes: [{ x: 521, y: 252, width: 254, height: 576, label: "dog", confidence: 0.97 }] }],
    }));
    expect(detections).toEqual([{ id: "dog-cat", boxes: [expect.objectContaining({ label: "dog" })] }]);
    expect(detections[0].boxes).toHaveLength(1);
  });

  it("accepts a cat-only box for a cat policy in the same mixed image", () => {
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "dog-cat", boxes: [{ x: 281, y: 472, width: 274, height: 376, label: "قطط", confidence: 0.98 }] }],
    }));
    expect(detections[0].boxes).toEqual([expect.objectContaining({ label: "قطط", x: 281, y: 472 })]);
  });

  it("drops low-confidence and tiny boxes instead of blurring unrelated image content", () => {
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "mixed", boxes: [
        { x: 20, y: 20, width: 400, height: 400, label: "uncertain cat", confidence: 0.52 },
        { x: 100, y: 100, width: 40, height: 70, label: "tiny cat", confidence: 0.99 },
      ] }],
    }));
    expect(detections).toEqual([{ id: "mixed", boxes: [] }]);
  });

  it("keeps distinct matching cats but drops duplicate overlapping boxes for the same object", () => {
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "three-cats", boxes: [
        { x: 80, y: 100, width: 220, height: 310, label: "cat", confidence: 0.96 },
        { x: 88, y: 108, width: 215, height: 300, label: "cat", confidence: 0.84 },
        { x: 610, y: 180, width: 220, height: 300, label: "cat", confidence: 0.93 },
      ] }],
    }));
    expect(detections[0].boxes).toHaveLength(2);
    expect(detections[0].boxes.map(box => box.x)).toEqual([80, 610]);
  });

  it("preserves an image-level unavailable status instead of converting it to a no-match", () => {
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "blocked-original", status: "unavailable", boxes: [] }],
    }));
    expect(detections).toEqual([{ id: "blocked-original", status: "unavailable", boxes: [] }]);
  });

  it("retains a sufficiently visible partial target while preserving a non-target-only image as no-match", () => {
    const detections = parseVisualReply(JSON.stringify({
      detections: [
        { id: "partial-cat", boxes: [{ x: 0, y: 380, width: 250, height: 310, label: "cat", confidence: 0.89 }] },
        { id: "dog-only", boxes: [] },
      ],
    }));
    expect(detections[0].boxes).toEqual([expect.objectContaining({ label: "cat", x: 0, confidence: 0.89 })]);
    expect(detections[1].boxes).toEqual([]);
  });
});
