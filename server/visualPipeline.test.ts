import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const localization = vi.hoisted(() => ({ localizeVisualMatches: vi.fn() }));
const verify = vi.hoisted(() => ({ verifyCandidates: vi.fn() }));
const fetching = vi.hoisted(() => ({ fetchRemoteImage: vi.fn() }));
vi.mock("./visualLocalization", async importOriginal => ({ ...(await importOriginal<typeof import("./visualLocalization")>()), ...localization }));
vi.mock("./visualVerify", async importOriginal => ({ ...(await importOriginal<typeof import("./visualVerify")>()), ...verify }));
vi.mock("./imageFetch", async importOriginal => ({ ...(await importOriginal<typeof import("./imageFetch")>()), ...fetching }));

import { detectImages, loadPixels, needsVerification } from "./visualPipeline";

const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 90, g: 90, b: 90 } } }).jpeg().toBuffer();

const box = (over: Partial<{ x: number; y: number; width: number; height: number; confidence: number; label: string }> = {}) =>
  ({ x: 200, y: 200, width: 400, height: 400, confidence: 0.95, label: "dog", ...over });

describe("deciding which results deserve a second look", () => {
  it("accepts a single confident, central, sizeable box without verifying", () => {
    expect(needsVerification([box()])).toBe(false);
    expect(needsVerification([])).toBe(false);
  });

  it("verifies when the result is weak, small, at an edge, or crowded", () => {
    expect(needsVerification([box({ confidence: 0.7 })])).toBe(true);
    expect(needsVerification([box({ width: 100, height: 100 })])).toBe(true);
    expect(needsVerification([box({ x: 0 })])).toBe(true);
    expect(needsVerification([box({ y: 700, height: 300 })])).toBe(true);
    expect(needsVerification([box(), box(), box()])).toBe(true);
  });
});

describe("pixel loading", () => {
  it("reads an inline data URL without touching the network", async () => {
    const bytes = await image(40, 40);
    expect(await loadPixels(`data:image/jpeg;base64,${bytes.toString("base64")}`)).toEqual(bytes);
    expect(fetching.fetchRemoteImage).not.toHaveBeenCalled();
  });

  it("returns nothing when a remote image is refused, rather than throwing", async () => {
    fetching.fetchRemoteImage.mockResolvedValue({ error: "blocked_address" });
    expect(await loadPixels("https://169.254.169.254/x.png")).toBeUndefined();
  });
});

describe("multi-pass detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetching.fetchRemoteImage.mockResolvedValue({ error: "unreachable" });
  });

  const input = (over: Record<string, unknown> = {}) => ({
    sourcePreference: "no dogs",
    rules: [{ term: "dog", action: "blur" as const }],
    images: [{ id: "a", url: "https://example.test/a.jpg" }],
    ...over,
  });

  it("fast mode makes exactly one call and never verifies", async () => {
    localization.localizeVisualMatches.mockResolvedValue([{ id: "a", boxes: [box({ confidence: 0.6 })] }]);
    await detectImages(input({ effort: "fast" }));
    expect(localization.localizeVisualMatches).toHaveBeenCalledTimes(1);
    expect(verify.verifyCandidates).not.toHaveBeenCalled();
  });

  it("sends fetched pixels inline instead of the URL, at every size", async () => {
    localization.localizeVisualMatches.mockResolvedValue([{ id: "a", boxes: [box()] }]);
    // A large image is not upscaled, and used to be passed on as a bare URL — which the
    // model provider then had to fetch itself. Hosts that refuse that fetch turned a
    // visible object into a silent no-match, so the bytes now always travel with it.
    for (const [width, height] of [[2400, 1600], [900, 600], [168, 94]]) {
      vi.clearAllMocks();
      localization.localizeVisualMatches.mockResolvedValue([{ id: "a", boxes: [box()] }]);
      fetching.fetchRemoteImage.mockResolvedValue({ bytes: await image(width, height), mime: "image/jpeg" });
      await detectImages(input({ effort: "thorough" }));
      const sent = localization.localizeVisualMatches.mock.calls[0][0].images[0];
      expect(sent.url.startsWith("data:image/jpeg;base64,")).toBe(true);
      const { width: outWidth, height: outHeight } = await sharp(Buffer.from(sent.url.split(",")[1], "base64")).metadata();
      // Bounded above so the payload stays affordable, and raised to the detection floor
      // when the source was a thumbnail.
      expect(Math.max(outWidth!, outHeight!)).toBeLessThanOrEqual(1_536);
      if (Math.max(width, height) < 768) expect(Math.max(outWidth!, outHeight!)).toBeGreaterThanOrEqual(768);
    }
  });

  it("falls back to the URL when the bytes cannot be decoded", async () => {
    localization.localizeVisualMatches.mockResolvedValue([{ id: "a", boxes: [box()] }]);
    fetching.fetchRemoteImage.mockResolvedValue({ bytes: Buffer.from("not an image"), mime: "image/jpeg" });
    await detectImages(input({ effort: "thorough" }));
    expect(localization.localizeVisualMatches.mock.calls[0][0].images[0].url).toBe("https://example.test/a.jpg");
  });

  it("thorough mode accepts a confident result without a second call", async () => {
    localization.localizeVisualMatches.mockResolvedValue([{ id: "a", boxes: [box()] }]);
    const result = await detectImages(input({ effort: "thorough" }));
    expect(localization.localizeVisualMatches).toHaveBeenCalledTimes(1);
    expect(verify.verifyCandidates).not.toHaveBeenCalled();
    expect(result[0].boxes).toHaveLength(1);
  });

  it("drops a candidate the verifier rejects and keeps one it confirms", async () => {
    const bytes = await image(900, 900);
    fetching.fetchRemoteImage.mockResolvedValue({ bytes, mime: "image/jpeg" });
    localization.localizeVisualMatches.mockResolvedValue([{ id: "a", boxes: [box({ confidence: 0.65 }), box({ x: 600, confidence: 0.66 })] }]);
    verify.verifyCandidates.mockResolvedValue([{ cropId: "a#0", present: false }, { cropId: "a#1", present: true }]);
    const result = await detectImages(input({ effort: "thorough" }));
    expect(verify.verifyCandidates).toHaveBeenCalledTimes(1);
    expect(result[0].boxes).toHaveLength(1);
    expect(result[0].boxes[0].x).toBe(600);
    // A box both passes agree on carries agreement as its confidence, not the model's guess.
    expect(result[0].boxes[0].confidence).toBeCloseTo(0.94, 2);
  });

  it("keeps the pass-1 result when verification throws", async () => {
    const bytes = await image(900, 900);
    fetching.fetchRemoteImage.mockResolvedValue({ bytes, mime: "image/jpeg" });
    localization.localizeVisualMatches.mockResolvedValue([{ id: "a", boxes: [box({ confidence: 0.65 })] }]);
    verify.verifyCandidates.mockRejectedValue(new Error("verifier down"));
    const result = await detectImages(input({ effort: "thorough" }));
    expect(result[0].boxes).toHaveLength(1);
  });

  it("retries a small image that came back empty, then stops", async () => {
    const bytes = await image(168, 94);
    fetching.fetchRemoteImage.mockResolvedValue({ bytes, mime: "image/jpeg" });
    localization.localizeVisualMatches
      .mockResolvedValueOnce([{ id: "a", boxes: [] }])
      .mockResolvedValueOnce([{ id: "a", boxes: [box()] }]);
    const result = await detectImages(input({ effort: "thorough" }));
    // Pass 1 plus one retry; the retry's confident box needs no verification.
    expect(localization.localizeVisualMatches).toHaveBeenCalledTimes(2);
    expect(verify.verifyCandidates).not.toHaveBeenCalled();
    expect(result[0].boxes).toHaveLength(1);
  });

  it("does not retry a large image that legitimately contains nothing", async () => {
    const bytes = await image(1600, 1200);
    fetching.fetchRemoteImage.mockResolvedValue({ bytes, mime: "image/jpeg" });
    localization.localizeVisualMatches.mockResolvedValue([{ id: "a", boxes: [] }]);
    await detectImages(input({ effort: "thorough" }));
    expect(localization.localizeVisualMatches).toHaveBeenCalledTimes(1);
  });

  it("skips the extra pass when too little of the deadline is left", async () => {
    const bytes = await image(900, 900);
    fetching.fetchRemoteImage.mockResolvedValue({ bytes, mime: "image/jpeg" });
    localization.localizeVisualMatches.mockImplementation(async () => {
      // Pass 1 alone eats most of the budget, as a slow model really does.
      await new Promise(resolve => setTimeout(resolve, 60));
      return [{ id: "a", boxes: [box({ confidence: 0.65 })] }];
    });
    const result = await detectImages(input({ effort: "thorough", deadlineMs: 50 }));
    // An extra pass landing after the caller gave up protects nothing.
    expect(verify.verifyCandidates).not.toHaveBeenCalled();
    expect(result[0].boxes).toHaveLength(1);
  });

  it("never verifies an image reported unavailable", async () => {
    localization.localizeVisualMatches.mockResolvedValue([{ id: "a", boxes: [], status: "unavailable" }]);
    const result = await detectImages(input({ effort: "thorough" }));
    expect(verify.verifyCandidates).not.toHaveBeenCalled();
    expect(result[0].status).toBe("unavailable");
  });
});
