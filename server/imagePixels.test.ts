import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { boxFromCrop, cropNormalizedBox, DETECTION_MIN_EDGE, imageMetadata, upscaleForDetection } from "./imagePixels";

/** A real encoded image, so sharp is exercised rather than mocked. */
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 40, b: 60 } } }).png().toBuffer();

describe("detection pixel preparation", () => {
  it("reads real dimensions from encoded bytes", async () => {
    expect(await imageMetadata(await solid(168, 94))).toEqual({ width: 168, height: 94 });
    expect(await imageMetadata(Buffer.from("not an image"))).toBeUndefined();
  });

  it("upscales a Google-sized thumbnail and leaves a large image alone", async () => {
    const thumbnail = await upscaleForDetection(await solid(168, 94));
    expect(thumbnail.upscaled).toBe(true);
    const enlarged = await imageMetadata(thumbnail.bytes);
    expect(enlarged!.width).toBeGreaterThanOrEqual(DETECTION_MIN_EDGE);
    // Aspect ratio must survive, or every box the model returns is skewed.
    expect(enlarged!.width / enlarged!.height).toBeCloseTo(168 / 94, 1);

    const large = await upscaleForDetection(await solid(1600, 1200));
    expect(large.upscaled).toBe(false);
  });

  it("does not upscale an image already at the threshold", async () => {
    expect((await upscaleForDetection(await solid(DETECTION_MIN_EDGE, 400))).upscaled).toBe(false);
    expect((await upscaleForDetection(await solid(DETECTION_MIN_EDGE - 1, 400))).upscaled).toBe(true);
  });

  it("cuts the requested region out with padding around it", async () => {
    const crop = await cropNormalizedBox(await solid(1000, 1000), { x: 400, y: 400, width: 200, height: 200 });
    expect(crop).toBeDefined();
    // 12% padding on each side of a 200-wide box widens the region to ~248.
    expect(crop!.region.width).toBeCloseTo(248, 0);
    expect(crop!.region.x).toBeCloseTo(376, 0);
  });

  it("keeps a crop of an edge box inside the image", async () => {
    const crop = await cropNormalizedBox(await solid(800, 600), { x: 0, y: 0, width: 200, height: 150 });
    expect(crop!.region.x).toBe(0);
    expect(crop!.region.y).toBe(0);
  });
});

describe("mapping a verified box back out of its crop", () => {
  it("returns the original coordinates for a box covering the whole crop", () => {
    const region = { x: 300, y: 200, width: 400, height: 300 };
    expect(boxFromCrop(region, { x: 0, y: 0, width: 1000, height: 1000 })).toMatchObject(region);
  });

  it("scales and offsets a box found inside the crop", () => {
    // Centre half of a crop that occupies the middle of the image.
    const mapped = boxFromCrop({ x: 200, y: 100, width: 400, height: 400 }, { x: 250, y: 250, width: 500, height: 500 });
    expect(mapped.x).toBeCloseTo(300, 5);
    expect(mapped.y).toBeCloseTo(200, 5);
    expect(mapped.width).toBeCloseTo(200, 5);
    expect(mapped.height).toBeCloseTo(200, 5);
  });

  it("never maps a box outside the image", () => {
    const mapped = boxFromCrop({ x: 900, y: 900, width: 100, height: 100 }, { x: 900, y: 900, width: 1000, height: 1000 });
    expect(mapped.x + mapped.width).toBeLessThanOrEqual(1000);
    expect(mapped.y + mapped.height).toBeLessThanOrEqual(1000);
  });
});
