import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const root = path.resolve("extension");
const output = path.resolve(process.argv[2] || "/home/ubuntu/webdev-static-assets/content-firewall-chrome-extension.zip");
const staging = path.resolve(".extension-package");
const unpackedOutput = path.resolve("/home/ubuntu/webdev-static-assets/content-firewall-chrome-extension-unpacked");

await mkdir(path.dirname(output), { recursive: true });
await rm(output, { force: true });
await rm(staging, { recursive: true, force: true });
await rm(unpackedOutput, { recursive: true, force: true });
await cp(root, unpackedOutput, { recursive: true, filter: source => !source.endsWith(".test.ts") });
await cp(unpackedOutput, staging, { recursive: true });
await run("zip", ["-r", output, "."], { cwd: staging });
await rm(staging, { recursive: true, force: true });
console.log(`Chrome extension package created: ${output}`);
console.log(`Chrome extension unpacked folder created: ${unpackedOutput}`);
