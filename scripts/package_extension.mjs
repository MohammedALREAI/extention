import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const root = path.resolve("extension");
const isWindows = process.platform === "win32";
const defaultZip = isWindows ? path.resolve("dist/content-firewall-chrome-extension.zip") : "/home/ubuntu/webdev-static-assets/content-firewall-chrome-extension.zip";
const defaultUnpacked = isWindows ? path.resolve("dist/content-firewall-chrome-extension-unpacked") : "/home/ubuntu/webdev-static-assets/content-firewall-chrome-extension-unpacked";
const output = path.resolve(process.argv[2] || defaultZip);
const staging = path.resolve(".extension-package");
const unpackedOutput = path.resolve(process.argv[3] || defaultUnpacked);

await mkdir(path.dirname(output), { recursive: true });
await rm(output, { force: true });
await rm(staging, { recursive: true, force: true });
await rm(unpackedOutput, { recursive: true, force: true });
await cp(root, unpackedOutput, { recursive: true, filter: source => !source.endsWith(".test.ts") });
await cp(unpackedOutput, staging, { recursive: true });
if (isWindows) {
  await run("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${staging}\\*' -DestinationPath '${output}' -Force`]);
} else {
  await run("zip", ["-r", output, "."], { cwd: staging });
}
await rm(staging, { recursive: true, force: true });
console.log(`Chrome extension package created: ${output}`);
console.log(`Chrome extension unpacked folder created: ${unpackedOutput}`);
