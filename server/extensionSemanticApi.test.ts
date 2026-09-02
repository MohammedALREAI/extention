import { describe, expect, it } from "vitest";
import { MAX_IMAGE_ID_LENGTH, MAX_INLINE_IMAGE_LENGTH, isAllowedExtensionOrigin, normalizeVisualRequestImages } from "./extensionSemanticApi";

describe("extension semantic API origin policy", () => {
  it("accepts browser extension origins and server-to-server calls without an Origin header", () => {
    expect(isAllowedExtensionOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop")).toBe(true);
    expect(isAllowedExtensionOrigin(undefined)).toBe(true);
  });

  it("rejects website, file, and malformed origins from the semantic API", () => {
    expect(isAllowedExtensionOrigin("https://example.com")).toBe(false);
    expect(isAllowedExtensionOrigin("file://")).toBe(false);
    expect(isAllowedExtensionOrigin("chrome-extension://not-an-extension-id")).toBe(false);
  });
});

describe("visual localization request normalization", () => {
  it("returns every accepted image id unchanged so detections can be matched back", () => {
    const id = `1787822574723:img:9fa31c07`;
    const [image] = normalizeVisualRequestImages([{ id, url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_a_very_long_google_thumbnail_reference_value_that_exceeds_any_id_bound", width: 275, height: 183 }]);
    expect(image.id).toBe(id);
    expect(image.width).toBe(275);
  });

  it("drops an over-long id or a non-HTTPS source instead of silently truncating it", () => {
    const images = normalizeVisualRequestImages([
      { id: "x".repeat(MAX_IMAGE_ID_LENGTH + 1), url: "https://example.test/dog.jpg" },
      { id: "spoofed-scheme", url: "javascript:alert(1)" },
      { id: "ok", url: "https://example.test/dog.jpg" },
    ]);
    expect(images.map(image => image.id)).toEqual(["ok"]);
  });

  it("accepts a bounded inline thumbnail when the page had no URL to send", () => {
    const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD=";
    const [image] = normalizeVisualRequestImages([{ id: "inline", url: "", dataUrl, width: 200, height: 130 }]);
    expect(image.url).toBe(dataUrl);
  });

  it("rejects an oversized or malformed inline image", () => {
    const images = normalizeVisualRequestImages([
      { id: "huge", dataUrl: `data:image/png;base64,${"A".repeat(MAX_INLINE_IMAGE_LENGTH)}` },
      { id: "not-an-image", dataUrl: "data:text/html;base64,PHNjcmlwdD4=" },
      { id: "unencoded", dataUrl: "data:image/svg+xml,<svg onload='x()'/>" },
    ]);
    expect(images).toEqual([]);
  });
});
