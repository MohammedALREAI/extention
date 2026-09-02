import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const iconRoot = path.join(projectRoot, "extension", "icons");
const expectedIcons = { 16: "icons/icon16.png", 32: "icons/icon32.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };

async function loadManifest() {
  return JSON.parse(await readFile(path.join(projectRoot, "extension", "manifest.json"), "utf8"));
}

describe("production extension manifest", () => {
  it("declares a versioned product identity, minimized API permissions, and a full icon family", async () => {
    const manifest = await loadManifest();
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("Content Firewall — Search Guard");
    expect(manifest.version).toBe("1.0.10");
    expect(manifest.description.length).toBeGreaterThanOrEqual(20);
    expect(manifest.description.length).toBeLessThanOrEqual(132);
    expect(manifest.permissions).toEqual(["storage", "tabs"]);
    expect(manifest.content_scripts[0].run_at).toBe("document_start");
    // Loopback is how the extension is pointed at a local server during development.
    // Any other insecure host would send real users' traffic in plaintext.
    const insecure = (manifest.host_permissions ?? []).filter((pattern: string) => pattern.startsWith("http://"));
    expect(insecure.every((pattern: string) => ["http://localhost/*", "http://127.0.0.1/*"].includes(pattern))).toBe(true);
    expect(manifest.icons).toEqual(expectedIcons);
    expect(manifest.action.default_icon).toEqual(expectedIcons);
  });

  it("ships readable PNGs at all Chrome toolbar and store icon sizes", async () => {
    for (const size of [16, 32, 48, 128]) {
      const icon = await readFile(path.join(iconRoot, `icon${size}.png`));
      expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(icon.readUInt32BE(16)).toBe(size);
      expect(icon.readUInt32BE(20)).toBe(size);
    }
  });
});
