/**
 * Runs detection over a case file and scores it. This is the half that was missing:
 * `scripts/eval_images.mjs` only scores a dataset whose `actual` boxes are already
 * filled in, and nothing produced them.
 *
 *   npx tsx scripts/eval_run.ts eval/cases.json
 *   npx tsx scripts/eval_run.ts eval/cases.json --effort fast
 *   npx tsx scripts/eval_run.ts eval/cases.json --repeat 3
 *
 * `--repeat` measures stability instead of accuracy: the same image detected N times,
 * reporting how much the answer moves. It needs no ground truth, so it gives a signal
 * before a labelled set exists — an unstable detector cannot be an accurate one.
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildReport } from "./eval_images.mjs";
import { detectImages, type DetectionEffort } from "../server/visualPipeline";
import type { VisualBox } from "../server/visualLocalization";

type Box = { x: number; y: number; width: number; height: number };
type EvalCase = { id: string; category: string; image: string; rules?: string[]; context?: string; expectedBoxes?: Box[] };
type Dataset = { schema: string; reviewed?: boolean; reviewedBy?: string; id?: string; rules?: string[]; cases: EvalCase[] };

const MIME_BY_EXTENSION: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

function flag(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function iou(a: Box, b: Box) {
  const left = Math.max(a.x, b.x); const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width); const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

/** A local path becomes a data URL; anything already a URL is passed through untouched. */
async function toImageReference(image: string) {
  if (/^(https?|data):/i.test(image)) return image;
  const bytes = await readFile(path.resolve(image));
  const mime = MIME_BY_EXTENSION[path.extname(image).toLowerCase()] || "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function detectOnce(item: EvalCase, rules: string[], effort: DetectionEffort) {
  const startedAt = Date.now();
  const [detection] = await detectImages({
    sourcePreference: `Do not show me: ${rules.join(", ")}`,
    rules: rules.map(term => ({ term, action: "blur" as const })),
    images: [{ id: item.id, url: await toImageReference(item.image), context: item.context }],
    effort,
  });
  return { boxes: (detection?.boxes ?? []) as VisualBox[], latencyMs: Date.now() - startedAt, unavailable: detection?.status === "unavailable" };
}

/** Mean IoU between every pair of runs, plus how often the box count agreed. */
function stability(runs: VisualBox[][]) {
  const counts = runs.map(boxes => boxes.length);
  const modal = counts.sort((a, b) => counts.filter(v => v === a).length - counts.filter(v => v === b).length).pop();
  const scores: number[] = [];
  for (let a = 0; a < runs.length; a += 1) {
    for (let b = a + 1; b < runs.length; b += 1) {
      const used = new Set<number>();
      for (const box of runs[a]) {
        let best = -1; let bestScore = 0;
        runs[b].forEach((other, index) => {
          if (used.has(index)) return;
          const score = iou(box, other);
          if (score > bestScore) { bestScore = score; best = index; }
        });
        if (best >= 0) used.add(best);
        scores.push(bestScore);
      }
    }
  }
  return {
    boxCounts: runs.map(boxes => boxes.length),
    countAgreement: counts.length ? counts.filter(value => value === modal).length / counts.length : null,
    meanPairwiseIou: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
  };
}

const inputPath = process.argv[2];
if (!inputPath || inputPath.startsWith("--")) throw new Error("Usage: npx tsx scripts/eval_run.ts <cases.json> [--effort fast|thorough] [--repeat N]");
const effort = flag("effort", "thorough") as DetectionEffort;
const repeat = Math.max(1, Number(flag("repeat", "1")) || 1);

// Windows editors and PowerShell write UTF-8 with a byte-order mark, which JSON.parse
// rejects with a message that names no cause. Strip it rather than blame the user.
const dataset = JSON.parse((await readFile(inputPath, "utf8")).replace(/^﻿/, "")) as Dataset;
if (!Array.isArray(dataset.cases) || !dataset.cases.length) throw new Error("The case file contains no cases.");

console.log(`\nRunning ${dataset.cases.length} case(s) at effort=${effort}${repeat > 1 ? `, repeat=${repeat}` : ""}\n`);

const stabilityRows: Array<Record<string, unknown>> = [];
for (const item of dataset.cases) {
  const rules = item.rules ?? dataset.rules ?? ["dog"];
  const runs: VisualBox[][] = [];
  let latencyMs = 0;
  let unavailable = false;
  for (let attempt = 0; attempt < repeat; attempt += 1) {
    try {
      const result = await detectOnce(item, rules, effort);
      runs.push(result.boxes);
      latencyMs = Math.max(latencyMs, result.latencyMs);
      unavailable = unavailable || result.unavailable;
    } catch (error) {
      console.error(`  ${item.id}: ${(error as Error).message}`);
      runs.push([]);
      unavailable = true;
    }
  }
  // The last run is the one scored; every run feeds the stability numbers.
  (item as EvalCase & { actual: unknown }).actual = { boxes: runs[runs.length - 1], latencyMs, unavailable };
  const measure = stability(runs);
  stabilityRows.push({ id: item.id, category: item.category, boxes: runs[runs.length - 1].length, latencyMs, ...(repeat > 1 ? measure : {}) });
  console.log(`  ${item.id.padEnd(24)} boxes=${runs[runs.length - 1].length} ${latencyMs}ms${unavailable ? " UNAVAILABLE" : ""}`);
}

console.log("");
console.table(stabilityRows);

const labelled = dataset.cases.some(item => Array.isArray(item.expectedBoxes));
if (!labelled) {
  console.log("\nNo expectedBoxes in this file, so precision and recall cannot be computed.");
  console.log("The run above still shows box counts, latency and — with --repeat — stability.\n");
} else {
  const report = buildReport({ ...dataset, cases: dataset.cases.map(item => ({ ...item, expectedBoxes: item.expectedBoxes ?? [] })) });
  const outputPath = path.join("eval/reports", `run-${effort}-${new Date().toISOString().slice(0, 10)}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir("eval/reports", { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  });
  console.table([report.metrics]);
  console.log(`\nWrote ${outputPath}\n`);
}
