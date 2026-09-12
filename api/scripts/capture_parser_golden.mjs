/**
 * Runs a corpus of model replies through the *TypeScript* parser and records what it
 * produced, so the Python port can be held to it.
 *
 *   npx tsx api/scripts/capture_parser_golden.mjs
 *
 * Two implementations that agree with their own authors prove nothing. This is the only
 * artefact that proves the port did not quietly change which boxes survive.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseVisualReply } from "../../server/visualLocalization.ts";

const box = (over = {}) => ({ x: 100, y: 100, width: 300, height: 300, label: "dog", confidence: 0.9, ...over });

/** Hand-written cases: every rule boundary, and every shape the model has actually produced. */
const handwritten = [
  ["plain match", { detections: [{ id: "a", boxes: [box()] }] }],
  ["empty boxes", { detections: [{ id: "a", boxes: [] }] }],
  ["missing boxes key", { detections: [{ id: "a" }] }],
  ["unavailable", { detections: [{ id: "a", status: "unavailable", boxes: [] }] }],
  ["unavailable with boxes", { detections: [{ id: "a", status: "unavailable", boxes: [box()] }] }],
  ["subject present", { detections: [{ id: "a", subject: "  a dog  ", boxes: [] }] }],
  ["subject overlong", { detections: [{ id: "a", subject: "x".repeat(200), boxes: [] }] }],
  ["label overlong", { detections: [{ id: "a", boxes: [box({ label: "y".repeat(200) })] }] }],
  ["label missing", { detections: [{ id: "a", boxes: [{ x: 100, y: 100, width: 300, height: 300, confidence: 0.9 }] }] }],
  ["label null", { detections: [{ id: "a", boxes: [box({ label: null })] }] }],
  ["arabic label", { detections: [{ id: "a", boxes: [box({ label: "قطط" })] }] }],
  ["id with whitespace", { detections: [{ id: "  a  ", boxes: [] }] }],
  ["string numbers", { detections: [{ id: "a", boxes: [box({ x: "100", width: "300", confidence: "0.9" })] }] }],
  ["null coordinate", { detections: [{ id: "a", boxes: [box({ x: null })] }] }],
  ["missing coordinate", { detections: [{ id: "a", boxes: [{ y: 100, width: 300, height: 300, confidence: 0.9 }] }] }],
  ["bool confidence", { detections: [{ id: "a", boxes: [box({ confidence: true })] }] }],
  ["array coordinate", { detections: [{ id: "a", boxes: [box({ x: [50] })] }] }],
  ["object coordinate", { detections: [{ id: "a", boxes: [box({ x: {} })] }] }],
  ["whole frame weak", { detections: [{ id: "a", boxes: [box({ x: 0, y: 0, width: 1000, height: 1000, confidence: 0.7 })] }] }],
  ["whole frame strong", { detections: [{ id: "a", boxes: [box({ x: 0, y: 0, width: 1000, height: 1000, confidence: 0.8 })] }] }],
  ["edge sliver", { detections: [{ id: "a", boxes: [box({ x: 0, y: 500, width: 30, height: 35, confidence: 0.7 })] }] }],
  ["mid sliver", { detections: [{ id: "a", boxes: [box({ x: 400, y: 500, width: 30, height: 35, confidence: 0.99 })] }] }],
  ["elongated", { detections: [{ id: "a", boxes: [box({ width: 600, height: 40, confidence: 0.95 })] }] }],
  ["aspect exactly 12", { detections: [{ id: "a", boxes: [box({ x: 0, y: 0, width: 480, height: 40, confidence: 0.95 })] }] }],
  ["overflow right", { detections: [{ id: "a", boxes: [box({ x: 900, width: 200 })] }] }],
  ["exactly at right edge", { detections: [{ id: "a", boxes: [box({ x: 700, width: 300 })] }] }],
  ["negative", { detections: [{ id: "a", boxes: [box({ x: -1 })] }] }],
  ["zero width", { detections: [{ id: "a", boxes: [box({ width: 0 })] }] }],
  ["nine boxes", { detections: [{ id: "a", boxes: Array.from({ length: 9 }, (_, i) => box({ x: i * 100, y: 0, width: 90, height: 300, label: `d${i}` })) }] }],
  ["duplicate overlap", { detections: [{ id: "a", boxes: [box({ x: 80, y: 100, width: 220, height: 310, label: "cat", confidence: 0.96 }), box({ x: 88, y: 108, width: 215, height: 300, label: "cat", confidence: 0.84 })] }] }],
  ["same label containment", { detections: [{ id: "a", boxes: [box({ x: 100, y: 100, width: 400, height: 400, confidence: 0.95 }), box({ x: 150, y: 150, width: 200, height: 200, confidence: 0.8 })] }] }],
  ["different label containment", { detections: [{ id: "a", boxes: [box({ x: 100, y: 100, width: 400, height: 400, confidence: 0.95 }), box({ x: 150, y: 150, width: 200, height: 200, label: "cat", confidence: 0.8 })] }] }],
  ["equal confidence ordering", { detections: [{ id: "a", boxes: [box({ x: 0, label: "p" }), box({ x: 600, label: "q" })] }] }],
  ["multiple detections", { detections: [{ id: "a", boxes: [box()] }, { id: "b", boxes: [] }, { id: "c", status: "unavailable", boxes: [] }] }],
  ["mask passthrough", { detections: [{ id: "a", boxes: [box({ mask: { rle: [1, 2, 3] } })] }] }],
  ["non-object box", { detections: [{ id: "a", boxes: ["nope", 5, null, box()] }] }],
];

/** Generated sweep across every threshold boundary, so nothing rests on a lucky sample. */
const generated = [];
for (const confidence of [0.4, 0.54, 0.55, 0.56, 0.61, 0.62, 0.63, 0.74, 0.75, 0.76, 0.99]) {
  for (const [x, y, w, h] of [[400, 400, 100, 100], [0, 400, 100, 100], [100, 100, 700, 600], [700, 120, 40, 45], [0, 0, 30, 30]]) {
    generated.push([`sweep c=${confidence} ${x},${y},${w}x${h}`, { detections: [{ id: "s", boxes: [box({ x, y, width: w, height: h, confidence })] }] }]);
  }
}

const wrappers = [
  ["raw", value => JSON.stringify(value)],
  ["fenced", value => "```json\n" + JSON.stringify(value) + "\n```"],
  ["prose", value => `Here you go:\n${JSON.stringify(value)}\nHope that helps!`],
];

const cases = [];
for (const [name, payload] of [...handwritten, ...generated]) {
  for (const [wrapper, wrap] of wrappers) {
    // Only wrap the handwritten cases every way; the sweep is about thresholds, not framing.
    if (wrapper !== "raw" && !handwritten.some(([n]) => n === name)) continue;
    const input = wrap(payload);
    let output = null;
    let error = null;
    try {
      output = parseVisualReply(input);
    } catch (failure) {
      error = String(failure?.message ?? failure);
    }
    cases.push({ name: `${name} [${wrapper}]`, input, output, error });
  }
}

const out = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "parser_golden.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ cases }, null, 2)}\n`, "utf8");
const failures = cases.filter(entry => entry.error).length;
console.log(`wrote ${cases.length} cases (${failures} of which throw) -> ${out}`);
