import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const commands = [
  ["pnpm", ["check"]],
  ["pnpm", ["test"]],
  ["pnpm", ["build"]],
  ["node", ["scripts/validate_extension.mjs"]],
  ["node", ["scripts/package_extension.mjs"]],
];

for (const [command, args] of commands) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = await run(command, args, { cwd: process.cwd() });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}
console.log("Release checks passed: type-check, tests, build, extension validation, and package.");
