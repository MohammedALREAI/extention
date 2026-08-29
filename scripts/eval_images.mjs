import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPORT_SCHEMA = "content-firewall-image-eval-report/v1";
const DATASET_SCHEMA = "content-firewall-image-eval/v1";

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function iou(a, b) {
  const left = Math.max(a.x, b.x); const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width); const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

function assertReviewedDataset(dataset) {
  if (dataset?.schema !== DATASET_SCHEMA || dataset?.reviewed !== true || !String(dataset?.reviewedBy || "").trim() || !Array.isArray(dataset?.cases) || !dataset.cases.length) {
    throw new Error(`A reviewed ${DATASET_SCHEMA} dataset with at least one case is required. Template data never produces a baseline.`);
  }
  const raw = JSON.stringify(dataset);
  if (/data:image|imageBytes|pixelData|base64Image/i.test(raw)) throw new Error("Evaluation datasets must contain labels, hashes, boxes, and outcomes only—never image bytes or pixels.");
}

export function buildReport(dataset, generatedAt = new Date().toISOString()) {
  assertReviewedDataset(dataset);
  let truePositives = 0; let falsePositives = 0; let falseNegatives = 0; let negativeCases = 0; let negativeFalsePositives = 0;
  const latencies = []; const costs = []; const byCategory = {};
  for (const item of dataset.cases) {
    const expected = Array.isArray(item.expectedBoxes) ? item.expectedBoxes : [];
    const actual = Array.isArray(item.actual?.boxes) ? item.actual.boxes : [];
    if (!item.id || !item.category || !item.actual || !Number.isFinite(Number(item.actual.latencyMs))) throw new Error(`Case ${String(item?.id || "unknown")} is missing reviewed category or actual outcome.`);
    latencies.push(Number(item.actual.latencyMs));
    if (Number.isFinite(Number(item.actual.costUsd))) costs.push(Number(item.actual.costUsd));
    const usedActual = new Set(); let matched = 0;
    for (const target of expected) {
      const hit = actual.findIndex((box, index) => !usedActual.has(index) && iou(target, box) >= 0.5);
      if (hit >= 0) { usedActual.add(hit); matched += 1; }
    }
    const fp = actual.length - matched;
    truePositives += matched; falseNegatives += expected.length - matched; falsePositives += fp;
    if (!expected.length) { negativeCases += 1; if (actual.length) negativeFalsePositives += 1; }
    const category = byCategory[item.category] ||= { cases: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0 };
    category.cases += 1; category.truePositives += matched; category.falsePositives += fp; category.falseNegatives += expected.length - matched;
  }
  const precision = truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : null;
  const recall = truePositives + falseNegatives ? truePositives / (truePositives + falseNegatives) : null;
  return {
    schema: REPORT_SCHEMA,
    generatedAt,
    dataset: { id: dataset.id || "unnamed", reviewedBy: dataset.reviewedBy, reviewedAt: dataset.reviewedAt || null, cases: dataset.cases.length },
    metrics: {
      precision,
      recall,
      missedDetectionRate: truePositives + falseNegatives ? falseNegatives / (truePositives + falseNegatives) : null,
      falsePositiveRate: negativeCases ? negativeFalsePositives / negativeCases : null,
      latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
      costUsdPer100Results: costs.length ? (costs.reduce((sum, value) => sum + value, 0) / costs.length) * 100 : null,
    },
    counts: { truePositives, falsePositives, falseNegatives, negativeCases, negativeFalsePositives },
    byCategory,
  };
}

export async function main(inputPath, outputDir) {
  const cliArgs = process.argv.slice(2).filter(argument => argument !== "--");
  const resolvedInputPath = inputPath || cliArgs[0];
  const resolvedOutputDir = outputDir || cliArgs[1] || "eval/reports";
  if (!resolvedInputPath) throw new Error("Usage: pnpm eval -- path/to/reviewed-cases.json [output-dir]");
  const dataset = JSON.parse(await readFile(resolvedInputPath, "utf8"));
  const report = buildReport(dataset);
  await mkdir(resolvedOutputDir, { recursive: true });
  const outputPath = path.join(resolvedOutputDir, `baseline-${new Date().toISOString().slice(0, 10)}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.table([{ cases: report.dataset.cases, precision: report.metrics.precision, recall: report.metrics.recall, missedDetectionRate: report.metrics.missedDetectionRate, falsePositiveRate: report.metrics.falsePositiveRate, p50LatencyMs: report.metrics.latencyMs.p50, p95LatencyMs: report.metrics.latencyMs.p95, costUsdPer100Results: report.metrics.costUsdPer100Results }]);
  console.log(`Wrote reviewed evaluation baseline: ${outputPath}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
