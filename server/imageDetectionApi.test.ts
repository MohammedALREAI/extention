import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getActiveDeveloperApiKeyByHash: vi.fn(),
  touchDeveloperApiKey: vi.fn(),
  recordDeveloperApiUsage: vi.fn(),
  recordImageUpload: vi.fn(),
  findImageUploadByHash: vi.fn(),
}));
const store = vi.hoisted(() => ({ saveImage: vi.fn(), readStoredImage: vi.fn() }));
const visual = vi.hoisted(() => ({ localizeVisualMatches: vi.fn() }));
vi.mock("./db", () => db);
vi.mock("./imageStore", async importOriginal => ({ ...(await importOriginal<typeof import("./imageStore")>()), ...store }));
vi.mock("./visualLocalization", async importOriginal => ({ ...(await importOriginal<typeof import("./visualLocalization")>()), ...visual }));

import { DEFAULT_CATEGORIES, parseImageDetectionRequest, registerImageDetectionApi } from "./imageDetectionApi";

const png = () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(800, 16);
  bytes.writeUInt32BE(600, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
};

function response() {
  const value: { statusCode?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  return { value, status(code: number) { value.statusCode = code; return this; }, json(body: unknown) { value.body = body; return this; }, send(body: unknown) { value.body = body; return this; }, setHeader(name: string, header: string) { value.headers[name] = header; return this; } };
}

function routesFor() {
  const routes = new Map<string, Function>();
  registerImageDetectionApi({ post: (path: string, handler: Function) => routes.set(`POST ${path}`, handler), get: (path: string, handler: Function) => routes.set(`GET ${path}`, handler) } as never);
  return routes;
}

// Keys must carry the cfk_ prefix; readBearerApiKey rejects anything else outright.
const request = (body: unknown, authorization = "Bearer cfk_test-secret") => ({ body, header: (name: string) => (name === "authorization" ? authorization : undefined), params: {} });

describe("image detection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getActiveDeveloperApiKeyByHash.mockResolvedValue({ id: 5, scopesJson: ["detect:image"], rateLimitPerMinute: 50 });
    db.recordImageUpload.mockResolvedValue({ createdAt: new Date("2026-01-01T00:00:00Z") });
    store.saveImage.mockResolvedValue("/tmp/stored.png");
    visual.localizeVisualMatches.mockResolvedValue([{ id: "hash", subject: "dog", boxes: [{ x: 10, y: 20, width: 300, height: 400, label: "dog", confidence: 0.97 }] }]);
  });

  it("normalizes categories and falls back to the built-in list", () => {
    expect(parseImageDetectionRequest({ image: "data:...", categories: [" Dog ", "DOG", "cat", "x"] }))
      .toMatchObject({ categories: ["dog", "cat"] });
    expect(parseImageDetectionRequest({ image: "data:..." })?.categories).toEqual(DEFAULT_CATEGORIES);
    expect(parseImageDetectionRequest({ categories: ["dog"] })).toBeUndefined();
  });

  it("returns the subject, the matched categories and where the image was stored", async () => {
    const handler = routesFor().get("POST /api/v1/images/detect")!;
    const result = response();
    await handler(request({ image: png(), categories: ["dog"] }), result);
    expect(result.value.statusCode).toBeUndefined();
    expect(result.value.body).toMatchObject({
      object: "image.detection",
      subject: "dog",
      categories: [{ label: "dog", confidence: 0.97, box: { x: 10, y: 20, width: 300, height: 400 } }],
      image: { mimeType: "image/png", width: 800, height: 600 },
    });
    expect(store.saveImage).toHaveBeenCalledTimes(1);
    expect(db.recordImageUpload).toHaveBeenCalledWith(expect.objectContaining({ apiKeyId: 5, subject: "dog", mimeType: "image/png" }));
  });

  it("stores nothing when the bytes are not the image type the caller declared", async () => {
    const handler = routesFor().get("POST /api/v1/images/detect")!;
    const result = response();
    await handler(request({ image: `data:image/png;base64,${Buffer.from("just some text, not an image").toString("base64")}` }), result);
    expect(result.value.statusCode).toBe(400);
    expect(result.value.body).toMatchObject({ error: { code: "unsupported_type" } });
    // Nothing reaches disk or the database on a rejected payload.
    expect(store.saveImage).not.toHaveBeenCalled();
    expect(db.recordImageUpload).not.toHaveBeenCalled();
  });

  it("refuses a key that lacks the image scope", async () => {
    db.getActiveDeveloperApiKeyByHash.mockResolvedValue({ id: 6, scopesJson: ["moderation:text"], rateLimitPerMinute: 50 });
    const handler = routesFor().get("POST /api/v1/images/detect")!;
    const result = response();
    await handler(request({ image: png() }), result);
    expect(result.value.statusCode).toBe(401);
    expect(visual.localizeVisualMatches).not.toHaveBeenCalled();
  });

  it("reports an unanalysable image as a failure rather than an empty result", async () => {
    visual.localizeVisualMatches.mockResolvedValue([{ id: "hash", boxes: [], status: "unavailable" }]);
    const handler = routesFor().get("POST /api/v1/images/detect")!;
    const result = response();
    await handler(request({ image: png() }), result);
    expect(result.value.statusCode).toBe(502);
    expect(db.recordImageUpload).not.toHaveBeenCalled();
  });

  it("serves a stored image only by its digest", async () => {
    const handler = routesFor().get("GET /api/v1/images/:name")!;
    const traversal = response();
    await handler({ ...request(undefined), params: { name: "../../.env" } }, traversal);
    expect(traversal.value.statusCode).toBe(400);
    expect(store.readStoredImage).not.toHaveBeenCalled();

    db.findImageUploadByHash.mockResolvedValue({ sha256: "a".repeat(64) });
    store.readStoredImage.mockResolvedValue({ bytes: Buffer.from([1, 2, 3]), type: { mime: "image/png", extension: "png" } });
    const found = response();
    await handler({ ...request(undefined), params: { name: `${"a".repeat(64)}.png` } }, found);
    expect(found.value.headers["Content-Type"]).toBe("image/png");
  });
});
