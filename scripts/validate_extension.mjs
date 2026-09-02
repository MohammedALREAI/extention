import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("extension");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const expectedIcons = { 16: "icons/icon16.png", 32: "icons/icon32.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function validatePng(filename, expectedSize) {
  const data = await readFile(path.join(root, "icons", filename));
  assert(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${filename} is not a PNG.`);
  assert(data.readUInt32BE(16) === expectedSize && data.readUInt32BE(20) === expectedSize, `${filename} must be ${expectedSize}×${expectedSize}.`);
}

if (manifest.manifest_version !== 3) throw new Error("Extension must use Manifest V3.");
assert(typeof manifest.name === "string" && manifest.name.length > 0 && manifest.name.length <= 45, "Manifest name must be present and no longer than 45 characters.");
assert(/^\d{1,4}\.\d{1,4}\.\d{1,4}(\.\d{1,4})?$/.test(manifest.version), "Manifest version must follow Chrome's numeric version format.");
assert(typeof manifest.description === "string" && manifest.description.length >= 20 && manifest.description.length <= 132, "Manifest description must be 20–132 characters.");
// Loopback over http is how the extension is tested against a local server; any
// other insecure host would ship plaintext traffic to real users.
const LOOPBACK_PERMISSIONS = ["http://localhost/*", "http://127.0.0.1/*"];
assert(
  !(manifest.host_permissions || []).some(pattern => pattern.startsWith("http://") && !LOOPBACK_PERMISSIONS.includes(pattern)),
  "Production manifest must not contain insecure HTTP host permissions beyond loopback.",
);
assert(JSON.stringify(manifest.icons) === JSON.stringify(expectedIcons), "Manifest must declare the four expected product icon sizes.");
assert(JSON.stringify(manifest.action?.default_icon) === JSON.stringify(expectedIcons), "Action must use the same icon family.");
if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length !== 1) throw new Error("Expected one content-script entry.");

const fileReferences = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...manifest.content_scripts.flatMap(entry => [...(entry.js || []), ...(entry.css || [])]),
].filter(Boolean);

await Promise.all(fileReferences.map(file => access(path.join(root, file), constants.R_OK)));
await Promise.all([16, 32, 48, 128].map(size => validatePng(`icon${size}.png`, size)));
console.log(`Production extension validation passed: Manifest V3, ${fileReferences.length} referenced files, and four source-folder icons.`);
