# Image Evaluation Protocol

The repository deliberately contains **no fabricated image cases, baseline values, image bytes, or pixels**. Use `eval/cases.template.json` only as a schema starting point. A real dataset may contain a sanitized image hash/reference, target boxes on a 0–1000 coordinate system, reviewed expected labels, the pipeline output boxes, latency, and optional cost. It must not contain embedded image data.

## Human-labeling rubric

Each case must be rights-cleared and independently reviewed. Include target-only images, target plus non-target images, multiple targets, partial/occluded targets, and visually similar non-targets. Keep the actual result tied to the extension/model revision and policy category. A box is a true positive only when it has IoU **≥ 0.50** with one reviewed expected target box; match each predicted and expected box once.

> Do not label an uncertain or unavailable visual inspection as a confirmed no-match. Preserve it as the actual failure state so the safety and availability metrics remain meaningful.

## Required reviewed case shape

```json
{
  "id": "hash-or-internal-reference-only",
  "category": "chosen-primary-category",
  "language": "ar",
  "expectedBoxes": [{ "x": 100, "y": 200, "width": 250, "height": 300 }],
  "actual": {
    "state": "match",
    "boxes": [{ "x": 110, "y": 205, "width": 240, "height": 290 }],
    "latencyMs": 740,
    "costUsd": 0.002
  }
}
```

## Running a reviewed baseline

After a reviewer sets the dataset root `reviewed: true`, supplies a non-empty `reviewedBy`, and records real cases, run:

```bash
pnpm eval -- path/to/reviewed-cases.json
```

The runner prints precision, recall, missed-detection rate, negative-case false-positive rate, p50/p95 latency, and estimated cost per 100 results. It writes a timestamped JSON report under `eval/reports/`. It rejects empty, unreviewed, or pixel-containing data rather than manufacturing a baseline.
