import type { FirewallRule } from "./firewall";
import { fetchRemoteImage } from "./imageFetch";
import { DETECTION_MIN_EDGE, boundForDetection, imageMetadata, toDetectionDataUrl, toJpeg, upscaleForDetection } from "./imagePixels";
import { localizeVisualMatches, type VisualBox, type VisualDetection } from "./visualLocalization";
import { applyVerdicts, buildVerifyCandidates, verifyCandidates, type VerifyCandidate } from "./visualVerify";

export type DetectionEffort = "fast" | "thorough";

export type PipelineImage = { id: string; url: string; width?: number; height?: number; context?: string };
export type PipelineInput = {
  sourcePreference: string;
  rules: FirewallRule[];
  images: PipelineImage[];
  effort?: DetectionEffort;
  describeSubject?: boolean;
  /**
   * Wall-clock budget for the whole pipeline. Extra passes are skipped rather than
   * started when too little of it remains: a caller that aborts mid-flight gets nothing
   * at all, so a merely-good answer inside the deadline beats a better one after it.
   */
  deadlineMs?: number;
};

/** A second model call needs roughly this long; below it, the pass is not worth starting. */
export const EXTRA_PASS_MIN_REMAINING_MS = 8_000;

/**
 * A pass-1 result earns a second look when any of these holds. Stated explicitly rather
 * than left to judgement, so the cost of verification is predictable and tunable.
 */
export const VERIFY_CONFIDENCE_BELOW = 0.8;
export const VERIFY_AREA_RATIO_BELOW = 0.05;
export const VERIFY_OVERLAP_COUNT = 3;
const NORMALIZED_AREA = 1_000_000;
const EDGE_THRESHOLD = 5;

export function needsVerification(boxes: VisualBox[]): boolean {
  if (!boxes.length) return false;
  if (boxes.length >= VERIFY_OVERLAP_COUNT) return true;
  return boxes.some(box =>
    box.confidence < VERIFY_CONFIDENCE_BELOW ||
    (box.width * box.height) / NORMALIZED_AREA < VERIFY_AREA_RATIO_BELOW ||
    box.x <= EDGE_THRESHOLD || box.y <= EDGE_THRESHOLD ||
    box.x + box.width >= 1000 - EDGE_THRESHOLD || box.y + box.height >= 1000 - EDGE_THRESHOLD);
}

const DATA_URL = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

/**
 * Gets the actual pixels for an image. Inline data URLs already carry them; a remote URL
 * has to be fetched, which is why `fetchRemoteImage` guards every address it is given.
 * Returns undefined when the bytes cannot be had — the pipeline then simply does less.
 */
export async function loadPixels(url: string): Promise<Buffer | undefined> {
  const inline = DATA_URL.exec(url.trim());
  if (inline) {
    try {
      return Buffer.from(inline[2], "base64");
    } catch {
      return undefined;
    }
  }
  const fetched = await fetchRemoteImage(url);
  return "error" in fetched ? undefined : fetched.bytes;
}

/** True when the image is small enough that pass 1 missing everything is suspicious. */
async function isSmallImage(bytes: Buffer) {
  const size = await imageMetadata(bytes);
  return Boolean(size && Math.max(size.width, size.height) < DETECTION_MIN_EDGE);
}

/**
 * Turns an image into what the model actually looks at: small ones upscaled, huge ones
 * bounded, and — whenever the bytes are in hand — sent inline rather than as a URL.
 *
 * Inlining matters more than the resizing. Handing over a URL makes the model provider
 * fetch it from its own network, with no cookies, no referer and no page context, and a
 * host that refuses that fetch (hotlink protection, a User-Agent check, a geo block)
 * failed the whole call. On screen that was indistinguishable from "no match": the image
 * stayed visible with nothing to say why.
 *
 * Boxes are normalized to 0-1000, so none of this needs coordinate remapping.
 */
async function preparedImage(image: PipelineImage, bytes: Buffer | undefined): Promise<PipelineImage> {
  if (!bytes) return image;
  try {
    const { bytes: sized } = await upscaleForDetection(bytes);
    return { ...image, url: toDetectionDataUrl(await toJpeg(await boundForDetection(sized))) };
  } catch {
    // Undecodable bytes: leave the URL and let the provider try, as it did before.
    return image;
  }
}

/**
 * Runs detection with an optional second look.
 *
 * `fast` is exactly the single call the extension has always made, kept both as a
 * fallback and so an A/B measurement has something to compare against.
 * `thorough` upscales small images, then verifies uncertain results, then retries once
 * on a small image that came back empty. Easy images still cost one call.
 */
export async function detectImages(input: PipelineInput): Promise<VisualDetection[]> {
  const effort = input.effort ?? "fast";
  if (effort === "fast") return localizeVisualMatches(input);

  const startedAt = Date.now();
  const remainingMs = () => (input.deadlineMs ?? Number.POSITIVE_INFINITY) - (Date.now() - startedAt);
  const canAffordAnotherPass = () => remainingMs() >= EXTRA_PASS_MIN_REMAINING_MS;

  const pixels = new Map<string, Buffer | undefined>();
  await Promise.all(input.images.map(async image => pixels.set(image.id, await loadPixels(image.url))));
  const prepared = await Promise.all(input.images.map(image => preparedImage(image, pixels.get(image.id))));

  let detections = await localizeVisualMatches({ ...input, images: prepared });

  // A small image that came back empty gets one more look at a larger size. Only then:
  // this is the third call, and it is reserved for the case that is most often wrong.
  const emptySmall = await Promise.all(detections.map(async detection => {
    if (detection.status === "unavailable" || detection.boxes.length) return false;
    const bytes = pixels.get(detection.id);
    return bytes ? isSmallImage(bytes) : false;
  }));
  if (emptySmall.some(Boolean) && canAffordAnotherPass()) {
    const retryIds = new Set(detections.filter((_, index) => emptySmall[index]).map(detection => detection.id));
    const retryImages = prepared.filter(image => retryIds.has(image.id));
    try {
      const retried = await localizeVisualMatches({ ...input, images: retryImages });
      const byId = new Map(retried.map(detection => [detection.id, detection]));
      detections = detections.map(detection => byId.get(detection.id) ?? detection);
    } catch {
      // A failed retry leaves the original empty result untouched.
    }
  }

  const uncertain = detections.filter(detection => detection.status !== "unavailable" && needsVerification(detection.boxes));
  if (!uncertain.length || !canAffordAnotherPass()) return detections;

  let candidates: VerifyCandidate[] = [];
  try {
    candidates = await buildVerifyCandidates(
      uncertain.flatMap(detection => {
        const bytes = pixels.get(detection.id);
        return bytes ? [{ id: detection.id, bytes, boxes: detection.boxes }] : [];
      }),
    );
    if (!candidates.length) return detections;
    const verdicts = await verifyCandidates(candidates);
    return detections.map(detection =>
      uncertain.includes(detection)
        ? { ...detection, boxes: applyVerdicts(detection.boxes, detection.id, candidates, verdicts) }
        : detection);
  } catch {
    // Verification is an improvement, never a dependency: its failure returns pass 1.
    return detections;
  }
}
