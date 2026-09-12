/**
 * Records the TypeScript coordinate arithmetic: crop regions, pixel rectangles, the
 * crop-to-frame mapping, and the resize targets.
 *
 *   npx tsx api/scripts/capture_geometry_golden.mjs
 *
 * This is where Math.round vs Python's banker's rounding actually bites. round(2.5) is 3
 * in JavaScript and 2 in Python; that one pixel shifts the crop, which shifts the verified
 * box, which moves the blur off the object it was covering.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { boxFromCrop, CROP_PADDING, DETECTION_MIN_EDGE, MAX_UPSCALED_EDGE, NORMALIZED } from "../../server/imagePixels.ts";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Mirrors the region + pixel maths inside cropNormalizedBox, which is not exported. */
function regionFor(box, padding = CROP_PADDING) {
  const padX = box.width * padding;
  const padY = box.height * padding;
  const left = clamp(box.x - padX, 0, NORMALIZED);
  const top = clamp(box.y - padY, 0, NORMALIZED);
  const right = clamp(box.x + box.width + padX, 0, NORMALIZED);
  const bottom = clamp(box.y + box.height + padY, 0, NORMALIZED);
  const region = { x: left, y: top, width: right - left, height: bottom - top };
  if (region.width <= 0 || region.height <= 0) return null;
  return region;
}

function pixelsFor(region, width, height) {
  const pixels = {
    left: Math.floor((region.x / NORMALIZED) * width),
    top: Math.floor((region.y / NORMALIZED) * height),
    width: Math.max(1, Math.round((region.width / NORMALIZED) * width)),
    height: Math.max(1, Math.round((region.height / NORMALIZED) * height)),
  };
  pixels.width = Math.min(pixels.width, width - pixels.left);
  pixels.height = Math.min(pixels.height, height - pixels.top);
  return pixels;
}

const BOXES = [
  { x: 100, y: 100, width: 300, height: 300 },
  { x: 0, y: 0, width: 1000, height: 1000 },
  { x: 0, y: 400, width: 60, height: 200 },
  { x: 940, y: 940, width: 60, height: 60 },
  { x: 700, y: 120, width: 40, height: 45 },
  { x: 1, y: 1, width: 1, height: 1 },
  { x: 333, y: 333, width: 333, height: 333 },
  { x: 499.5, y: 499.5, width: 1, height: 1 },
  { x: 0, y: 0, width: 5, height: 5 },
  { x: 995, y: 0, width: 5, height: 1000 },
];

const SIZES = [
  [168, 94], [275, 183], [640, 480], [1000, 1000], [1, 1], [3, 7], [4000, 2250], [1536, 1536], [767, 768],
];

const regions = [];
for (const box of BOXES) {
  for (const padding of [CROP_PADDING, 0, 0.5]) {
    const region = regionFor(box, padding);
    regions.push({
      box,
      padding,
      region,
      pixels: region ? SIZES.map(([w, h]) => ({ imageWidth: w, imageHeight: h, rect: pixelsFor(region, w, h) })) : null,
    });
  }
}

const INNER = [
  { x: 0, y: 0, width: 1000, height: 1000 },
  { x: 500, y: 500, width: 250, height: 250 },
  { x: 0, y: 0, width: 1, height: 1 },
  { x: 999, y: 999, width: 1, height: 1 },
  { x: 250, y: 100, width: 500, height: 800 },
];

const mappings = [];
for (const box of BOXES) {
  const region = regionFor(box);
  if (!region) continue;
  for (const inner of INNER) {
    mappings.push({ region, inner, output: boxFromCrop(region, inner) });
  }
}

/** Mirrors the target-size maths in upscaleForDetection / boundForDetection. */
const resizes = SIZES.map(([width, height]) => {
  const longest = Math.max(width, height);
  const upscale = longest >= DETECTION_MIN_EDGE
    ? null
    : (() => {
        const factor = Math.min(DETECTION_MIN_EDGE / longest, MAX_UPSCALED_EDGE / longest);
        return { width: Math.round(width * factor), height: Math.round(height * factor) };
      })();
  const bound = longest <= MAX_UPSCALED_EDGE
    ? null
    : { width: Math.round(width * (MAX_UPSCALED_EDGE / longest)), height: Math.round(height * (MAX_UPSCALED_EDGE / longest)) };
  return { width, height, upscale, bound };
});

/** Math.round itself, at the values where the two languages disagree. */
const rounding = [-2.5, -1.5, -0.5, 0, 0.5, 1.5, 2.5, 3.5, 4.5, 0.49999999999999994, 1.005, 2.675]
  .map(value => ({ value, rounded: Math.round(value) }));

const out = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "geometry_golden.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ regions, mappings, resizes, rounding }, null, 2)}\n`, "utf8");
console.log(`wrote ${regions.length} regions, ${mappings.length} mappings, ${resizes.length} resizes -> ${out}`);
