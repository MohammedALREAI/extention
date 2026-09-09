import { describe, expect, it } from "vitest";
import { cleanJsonText, containmentRatio, describeImageForPrompt, isEdgeBox, parseVisualReply } from "./visualLocalization";

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
        // Below the minimum box area even after it was lowered for background objects.
        { x: 100, y: 100, width: 20, height: 40, label: "speck", confidence: 0.99 },
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

  it("labels each image with its dimensions and its caption for the prompt", () => {
    expect(describeImageForPrompt({ id: "img-1", width: 275, height: 183, context: "Dog vs Cat" }))
      .toBe('img-1 (275×183) — nearby page text: "Dog vs Cat"');
    // An image with no caption must not gain an empty quoted field.
    expect(describeImageForPrompt({ id: "img-2", width: 275, height: 183 })).toBe("img-2 (275×183)");
    expect(describeImageForPrompt({ id: "img-3" })).toBe("img-3");
  });

  it("preserves an image-level unavailable status instead of converting it to a no-match", () => {
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "blocked-original", status: "unavailable", boxes: [] }],
    }));
    expect(detections).toEqual([{ id: "blocked-original", status: "unavailable", boxes: [] }]);
  });

  it("keeps a partially visible edge detection that the same confidence would fail mid-image", () => {
    const clipped = { x: 0, y: 400, width: 60, height: 200, label: "cat", confidence: 0.58 };
    const detections = parseVisualReply(JSON.stringify({
      detections: [
        { id: "clipped", boxes: [clipped] },
        // Identical shape and confidence, but fully inside the frame: no clipping
        // explains the weaker score, so the normal threshold applies.
        { id: "middle", boxes: [{ ...clipped, x: 400 }] },
      ],
    }));
    expect(isEdgeBox(clipped)).toBe(true);
    expect(detections[0].boxes).toEqual([expect.objectContaining({ x: 0, confidence: 0.58 })]);
    expect(detections[1].boxes).toEqual([]);
  });

  it("accepts a small edge sliver of an object while rejecting the same area mid-image", () => {
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "areas", boxes: [
        { x: 0, y: 500, width: 30, height: 35, label: "cat", confidence: 0.7 },
        { x: 400, y: 500, width: 30, height: 35, label: "cat", confidence: 0.99 },
      ] }],
    }));
    expect(detections[0].boxes).toEqual([expect.objectContaining({ x: 0 })]);
  });

  it("demands more confidence from a box claiming most of the image", () => {
    const large = { x: 100, y: 100, width: 700, height: 600, label: "dog", confidence: 0.73 };
    const [weak, strong] = parseVisualReply(JSON.stringify({
      detections: [{ id: "weak", boxes: [large] }, { id: "strong", boxes: [{ ...large, confidence: 0.78 }] }],
    }));
    expect(weak.boxes).toEqual([]);
    expect(strong.boxes).toHaveLength(1);
  });

  it("drops a same-label box contained in a stronger one but keeps a different label there", () => {
    const outer = { x: 100, y: 100, width: 400, height: 400, label: "dog", confidence: 0.95 };
    const inner = { x: 150, y: 150, width: 200, height: 200, confidence: 0.8 };
    expect(containmentRatio(outer, { ...inner, label: "dog" })).toBe(1);
    const [sameLabel, otherLabel] = parseVisualReply(JSON.stringify({
      detections: [
        { id: "same-label", boxes: [outer, { ...inner, label: "dog" }] },
        // A cat sitting on a dog is a separate match, not a duplicate detection.
        { id: "other-label", boxes: [outer, { ...inner, label: "cat" }] },
      ],
    }));
    expect(sameLabel.boxes).toEqual([expect.objectContaining({ label: "dog", width: 400 })]);
    expect(otherLabel.boxes.map(box => box.label)).toEqual(["dog", "cat"]);
  });

  it("returns only the blocked object from a dog, cat and car image", () => {
    // The acceptance case: one rule, three subjects, one box.
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "dog-cat-car", boxes: [
        { x: 60, y: 300, width: 240, height: 320, label: "dog", confidence: 0.91 },
      ] }],
    }));
    expect(detections[0].boxes).toEqual([expect.objectContaining({ label: "dog" })]);
  });

  it("keeps a small background instance that the previous floors discarded", () => {
    // 40×45 is 0.18% of the frame — under the old 0.4% area floor and the old 0.72
    // confidence floor, so a distant dog used to vanish from the result.
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "background", boxes: [{ x: 700, y: 120, width: 40, height: 45, label: "dog", confidence: 0.66 }] }],
    }));
    expect(detections[0].boxes).toEqual([expect.objectContaining({ label: "dog", width: 40 })]);
  });

  it("still refuses a whole-image box at the confidence a small object now passes", () => {
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "everything", boxes: [{ x: 5, y: 5, width: 980, height: 980, label: "dog", confidence: 0.66 }] }],
    }));
    expect(detections[0].boxes).toEqual([]);
  });

  it("rejects an extremely elongated sliver that no real object would fill", () => {
    const detections = parseVisualReply(JSON.stringify({
      detections: [{ id: "sliver", boxes: [{ x: 100, y: 100, width: 600, height: 40, label: "dog", confidence: 0.95 }] }],
    }));
    expect(detections[0].boxes).toEqual([]);
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

  it("parses model replies wrapped in markdown code blocks or with surrounding whitespace", () => {
    const json = JSON.stringify({
      detections: [{ id: "fenced-dog", boxes: [{ x: 100, y: 100, width: 300, height: 300, label: "dog", confidence: 0.9 }] }],
    });
    const markdownReply = `\`\`\`json\n${json}\n\`\`\``;
    const detections = parseVisualReply(markdownReply);
    expect(detections).toHaveLength(1);
    expect(detections[0].id).toBe("fenced-dog");
    expect(detections[0].boxes).toHaveLength(1);
  });

  it("cleans json text with conversational prefixes or suffixes", () => {
    const raw = `Here is the visual localization output:\n{"detections":[{"id":"test","boxes":[]}]}\nHope this helps!`;
    expect(cleanJsonText(raw)).toBe('{"detections":[{"id":"test","boxes":[]}]}');
  });
});
