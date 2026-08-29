import { describe, expect, it } from "vitest";
import { MAX_IMAGE_ID_LENGTH, isAllowedExtensionOrigin, normalizeVisualRequestImages } from "./extensionSemanticApi";

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
      { id: "inline", url: "data:image/jpeg;base64,AAAA" },
      { id: "ok", url: "https://example.test/dog.jpg" },
    ]);
    expect(images.map(image => image.id)).toEqual(["ok"]);
  });
});
