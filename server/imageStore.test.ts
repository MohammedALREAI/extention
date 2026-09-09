import { describe, expect, it } from "vitest";
import { decodeImageDataUrl, detectImageType, imageDimensions, MAX_UPLOAD_BYTES, storedFileName } from "./imageStore";

// Smallest structurally valid headers; enough for signature and dimension parsing.
const png = () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(1600, 16);
  bytes.writeUInt32BE(1067, 20);
  return bytes;
};
const gif = () => Buffer.concat([Buffer.from("GIF89a", "latin1"), (() => { const b = Buffer.alloc(6); b.writeUInt16LE(320, 0); b.writeUInt16LE(240, 2); return b; })()]);
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

describe("uploaded image identification", () => {
  it("identifies a type from the bytes, not from what the caller called it", () => {
    expect(detectImageType(png())?.mime).toBe("image/png");
    expect(detectImageType(gif())?.mime).toBe("image/gif");
    expect(detectImageType(Buffer.from("<html>this is not an image at all</html>"))).toBeUndefined();
  });

  it("rejects a text payload dressed up as a PNG", () => {
    // The whole point of the check: the declared mime is attacker-controlled text.
    const disguised = dataUrl("image/png", Buffer.from("GIF-not-really <script>alert(1)</script>"));
    expect(decodeImageDataUrl(disguised)).toEqual({ error: "unsupported_type" });
  });

  it("stores a real image under the hash of its bytes and reports its size", () => {
    const decoded = decodeImageDataUrl(dataUrl("image/png", png()));
    expect("error" in decoded).toBe(false);
    if ("error" in decoded) return;
    expect(decoded.type.extension).toBe("png");
    expect(decoded.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(decoded.dimensions).toEqual({ width: 1600, height: 1067 });
    // Identical bytes must land on the identical name — that is what makes a re-upload
    // free instead of a second stored copy.
    const again = decodeImageDataUrl(dataUrl("image/jpeg", png()));
    if ("error" in again) throw new Error("expected a decode");
    expect(again.sha256).toBe(decoded.sha256);
  });

  it("reads GIF dimensions and gives up rather than guessing on a truncated header", () => {
    expect(imageDimensions(gif(), { mime: "image/gif", extension: "gif" })).toEqual({ width: 320, height: 240 });
    expect(imageDimensions(Buffer.alloc(4), { mime: "image/png", extension: "png" })).toBeUndefined();
  });

  it("refuses payloads that are not data URLs, are empty, or exceed the cap", () => {
    expect(decodeImageDataUrl("https://example.test/dog.jpg")).toEqual({ error: "not_a_data_url" });
    expect(decodeImageDataUrl(undefined)).toEqual({ error: "not_a_data_url" });
    expect(decodeImageDataUrl("data:image/png;base64,")).toEqual({ error: "not_a_data_url" });
    const oversized = `data:image/png;base64,${"A".repeat(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4)}`;
    expect(decodeImageDataUrl(oversized)).toEqual({ error: "too_large" });
  });

  it("never builds a filename from anything but a digest", () => {
    const type = { mime: "image/png", extension: "png" };
    expect(storedFileName("a".repeat(64), type)).toBe(`${"a".repeat(64)}.png`);
    // A traversal attempt must throw rather than resolve to a path outside the store.
    expect(() => storedFileName("../../etc/passwd", type)).toThrow();
    expect(() => storedFileName("A".repeat(64), type)).toThrow();
  });
});
