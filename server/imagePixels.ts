import sharp from "sharp";

/** A 168x94 thumbnail carries almost no signal for a detector; this is the floor. */
export const DETECTION_MIN_EDGE = 768;
/** Ceiling on an upscale, so a 16px icon cannot be blown up into a huge payload. */
export const MAX_UPSCALED_EDGE = 1_536;
/** Context kept around a crop so the verifier can see whether the box cut the object short. */
export const CROP_PADDING = 0.12;
export const NORMALIZED = 1000;

export type NormalizedBox = { x: number; y: number; width: number; height: number };
export type CropResult = { bytes: Buffer; region: NormalizedBox };

/** Undecodable bytes make sharp throw; a bad image must not take the pipeline with it. */
export async function imageMetadata(bytes: Buffer) {
  try {
    const { width, height } = await sharp(bytes).metadata();
    return width && height ? { width, height } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Upscales an image whose longest edge is below `minEdge`. This adds no information —
 * it changes what the model reports on the same pixels, which for small thumbnails is
 * the difference between "no dog" and a usable box.
 * Boxes are normalized to 0-1000, so the caller needs no coordinate remapping.
 */
export async function upscaleForDetection(bytes: Buffer, minEdge = DETECTION_MIN_EDGE) {
  const size = await imageMetadata(bytes);
  if (!size) return { bytes, upscaled: false };
  const longest = Math.max(size.width, size.height);
  if (longest >= minEdge) return { bytes, upscaled: false };
  // Bound the *result*, not the factor: capping the factor at 4 left a 168px thumbnail
  // at 672px, short of the very floor this exists to reach.
  const factor = Math.min(minEdge / longest, MAX_UPSCALED_EDGE / longest);
  const resized = await sharp(bytes)
    .resize({ width: Math.round(size.width * factor), height: Math.round(size.height * factor), kernel: "lanczos3" })
    .toBuffer();
  return { bytes: resized, upscaled: true };
}

/**
 * Shrinks an image whose longest edge exceeds `maxEdge`. Detection gains nothing from a
 * 4000px photo, and every extra pixel is base64 in a prompt, so this is what keeps
 * inlining the pixels affordable.
 */
export async function boundForDetection(bytes: Buffer, maxEdge = MAX_UPSCALED_EDGE) {
  const size = await imageMetadata(bytes);
  if (!size) return bytes;
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) return bytes;
  const factor = maxEdge / longest;
  return sharp(bytes)
    .resize({ width: Math.round(size.width * factor), height: Math.round(size.height * factor) })
    .toBuffer();
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Cuts a normalized box out of an image, padded for context. The returned `region` is
 * what was actually cut — the caller needs it to map a box found inside the crop back
 * into the original frame, since the crop is a new coordinate space.
 */
export async function cropNormalizedBox(bytes: Buffer, box: NormalizedBox, padding = CROP_PADDING): Promise<CropResult | undefined> {
  const size = await imageMetadata(bytes);
  if (!size) return undefined;
  const padX = box.width * padding;
  const padY = box.height * padding;
  const left = clamp(box.x - padX, 0, NORMALIZED);
  const top = clamp(box.y - padY, 0, NORMALIZED);
  const right = clamp(box.x + box.width + padX, 0, NORMALIZED);
  const bottom = clamp(box.y + box.height + padY, 0, NORMALIZED);
  const region = { x: left, y: top, width: right - left, height: bottom - top };
  if (region.width <= 0 || region.height <= 0) return undefined;

  const pixels = {
    left: Math.floor((region.x / NORMALIZED) * size.width),
    top: Math.floor((region.y / NORMALIZED) * size.height),
    width: Math.max(1, Math.round((region.width / NORMALIZED) * size.width)),
    height: Math.max(1, Math.round((region.height / NORMALIZED) * size.height)),
  };
  pixels.width = Math.min(pixels.width, size.width - pixels.left);
  pixels.height = Math.min(pixels.height, size.height - pixels.top);
  const cropped = await sharp(bytes).extract(pixels).toBuffer();
  // Crops are small by definition, so they are upscaled again before being looked at.
  const { bytes: prepared } = await upscaleForDetection(cropped);
  return { bytes: prepared, region };
}

/**
 * Maps a box found inside a crop back into the original image's coordinates.
 * Without this every verified box would be reported relative to the wrong frame.
 */
export function boxFromCrop(region: NormalizedBox, boxInCrop: NormalizedBox): NormalizedBox {
  const scaleX = region.width / NORMALIZED;
  const scaleY = region.height / NORMALIZED;
  const x = region.x + boxInCrop.x * scaleX;
  const y = region.y + boxInCrop.y * scaleY;
  const width = boxInCrop.width * scaleX;
  const height = boxInCrop.height * scaleY;
  return {
    x: clamp(x, 0, NORMALIZED),
    y: clamp(y, 0, NORMALIZED),
    width: clamp(width, 1, NORMALIZED - clamp(x, 0, NORMALIZED)),
    height: clamp(height, 1, NORMALIZED - clamp(y, 0, NORMALIZED)),
  };
}

export function toDetectionDataUrl(bytes: Buffer, mime = "image/jpeg") {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/** Re-encodes to JPEG so a crop travels as a compact payload regardless of its source. */
export async function toJpeg(bytes: Buffer, quality = 82) {
  return sharp(bytes).jpeg({ quality }).toBuffer();
}
