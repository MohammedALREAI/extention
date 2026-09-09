import type { Express, Request, Response } from "express";
import { findImageUploadByHash, getActiveDeveloperApiKeyByHash, recordDeveloperApiUsage, recordImageUpload, touchDeveloperApiKey } from "./db";
import { hashDeveloperApiKey, readBearerApiKey } from "./developerKeys";
import { allowDeveloperRequest } from "./developerModerationApi";
import { decodeImageDataUrl, readStoredImage, saveImage, toDataUrl, type DecodedUpload } from "./imageStore";
import { localizeVisualMatches } from "./visualLocalization";

export const IMAGE_SCOPE = "detect:image";
export const MAX_CATEGORIES = 20;

/**
 * Categories the detector looks for when the caller does not name any. Extending
 * detection to something new is this list plus nothing else — the model is told the
 * categories at call time, so no code changes to add one.
 */
export const DEFAULT_CATEGORIES = ["dog", "cat", "car", "person", "horse", "bird", "weapon", "alcohol"];

export type ImageDetectionRequest = { image: string; categories: string[] };

export function parseImageDetectionRequest(body: unknown): ImageDetectionRequest | undefined {
  const source = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (typeof source.image !== "string" || !source.image) return undefined;
  const requested = Array.isArray(source.categories) ? source.categories : DEFAULT_CATEGORIES;
  const categories = Array.from(new Set(requested
    .map(value => String(value ?? "").normalize("NFC").trim().toLocaleLowerCase())
    .filter(value => value.length >= 2 && value.length <= 40))).slice(0, MAX_CATEGORIES);
  if (!categories.length) return undefined;
  return { image: source.image, categories };
}

const DECODE_MESSAGES: Record<string, string> = {
  not_a_data_url: "Provide the image as a base64 data URL, for example data:image/png;base64,iVBORw0...",
  too_large: "The image is larger than the 6 MB upload limit.",
  malformed_base64: "The data URL payload is not valid base64.",
  unsupported_type: "The uploaded bytes are not a PNG, JPEG, GIF or WEBP image.",
};

export async function detectStoredImage(upload: DecodedUpload, categories: string[]) {
  const [detection] = await localizeVisualMatches({
    sourcePreference: `Identify the main subject, and locate any of these categories: ${categories.join(", ")}.`,
    rules: categories.map(term => ({ term, action: "blur" as const })),
    images: [{ id: upload.sha256, url: toDataUrl(upload.bytes, upload.type), width: upload.dimensions?.width, height: upload.dimensions?.height }],
    describeSubject: true,
  });
  if (!detection || detection.status === "unavailable") return undefined;
  return {
    subject: detection.subject,
    categories: detection.boxes.map(box => ({
      label: box.label,
      confidence: box.confidence,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    })),
  };
}

export function registerImageDetectionApi(app: Express) {
  app.post("/api/v1/images/detect", async (request: Request, response: Response) => {
    const secret = readBearerApiKey(request.header("authorization"));
    if (!secret) return response.status(401).json({ error: { code: "invalid_api_key", message: "A valid Bearer API key is required." } });
    const key = await getActiveDeveloperApiKeyByHash(hashDeveloperApiKey(secret));
    if (!key || !key.scopesJson.includes(IMAGE_SCOPE)) return response.status(401).json({ error: { code: "invalid_api_key", message: "API key is invalid, revoked, expired, or lacks this scope." } });
    if (!allowDeveloperRequest(key.id, key.rateLimitPerMinute)) return response.status(429).json({ error: { code: "rate_limited", message: "Rate limit reached. Retry after one minute." } });

    const input = parseImageDetectionRequest(request.body);
    if (!input) return response.status(400).json({ error: { code: "invalid_request", message: "Provide an image data URL and up to 20 category names." } });

    // Decoded and identified before anything touches disk: an unreadable or mislabelled
    // payload must never become a stored file.
    const decoded = decodeImageDataUrl(input.image);
    if ("error" in decoded) return response.status(400).json({ error: { code: decoded.error, message: DECODE_MESSAGES[decoded.error] } });

    const startedAt = Date.now();
    let httpStatus = 200;
    try {
      await saveImage(decoded);
      const detected = await detectStoredImage(decoded, input.categories);
      if (!detected) {
        httpStatus = 502;
        return response.status(502).json({ error: { code: "detection_unavailable", message: "The image was stored but could not be analysed." } });
      }
      const stored = await recordImageUpload({
        apiKeyId: key.id,
        sha256: decoded.sha256,
        mimeType: decoded.type.mime,
        byteSize: decoded.bytes.length,
        width: decoded.dimensions?.width,
        height: decoded.dimensions?.height,
        subject: detected.subject,
        labels: detected.categories,
      });
      response.setHeader("Cache-Control", "no-store");
      return response.json({
        object: "image.detection",
        image: {
          id: decoded.sha256,
          mimeType: decoded.type.mime,
          bytes: decoded.bytes.length,
          ...(decoded.dimensions ?? {}),
          url: `/api/v1/images/${decoded.sha256}.${decoded.type.extension}`,
          storedAt: stored?.createdAt ?? null,
        },
        subject: detected.subject ?? null,
        categories: detected.categories,
      });
    } catch (error) {
      console.error("[Image detection]", error);
      httpStatus = 502;
      return response.status(502).json({ error: { code: "detection_unavailable", message: "Image detection was unavailable." } });
    } finally {
      const latencyMs = Date.now() - startedAt;
      void Promise.all([
        touchDeveloperApiKey(key.id),
        recordDeveloperApiUsage({ apiKeyId: key.id, itemCount: 1, matchCount: 0, noMatchCount: 0, unavailableCount: httpStatus === 200 ? 0 : 1, latencyMs, httpStatus }),
      ]).catch(usageError => console.error("[Image detection usage]", usageError));
    }
  });

  app.get("/api/v1/images/:name", async (request: Request, response: Response) => {
    const secret = readBearerApiKey(request.header("authorization"));
    if (!secret) return response.status(401).json({ error: { code: "invalid_api_key", message: "A valid Bearer API key is required." } });
    const key = await getActiveDeveloperApiKeyByHash(hashDeveloperApiKey(secret));
    if (!key || !key.scopesJson.includes(IMAGE_SCOPE)) return response.status(401).json({ error: { code: "invalid_api_key", message: "API key is invalid, revoked, expired, or lacks this scope." } });

    // The name is split rather than used as a path: only a 64-hex digest and a known
    // extension can address a file, so nothing a caller sends can escape the directory.
    const [sha256, extension] = String(request.params.name ?? "").split(".");
    if (!/^[a-f0-9]{64}$/.test(sha256 ?? "") || !extension) return response.status(400).json({ error: { code: "invalid_request", message: "Request an image by its returned id." } });
    const record = await findImageUploadByHash(sha256);
    if (!record) return response.status(404).json({ error: { code: "not_found", message: "No stored image with that id." } });
    const file = await readStoredImage(sha256, extension);
    if (!file) return response.status(404).json({ error: { code: "not_found", message: "The stored file for that id is missing." } });
    response.setHeader("Content-Type", file.type.mime);
    response.setHeader("Cache-Control", "private, max-age=300");
    return response.send(file.bytes);
  });
}
