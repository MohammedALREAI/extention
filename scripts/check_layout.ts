/**
 * Finds elements that push the page wider than the viewport, at the widths people
 * actually use.
 *
 *   npx tsx scripts/check_layout.ts
 *   npx tsx scripts/check_layout.ts 360,768
 *
 * Horizontal overflow is the one layout fault a screenshot can hide: the page looks
 * cropped rather than broken, and on a phone it shows up as a sideways scroll nobody
 * meant to add. Reported per route, naming the widest offender rather than just the fact.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

const BASE = (process.env.CF_CHECK_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const ROUTES = ["/", "/tutorial", "/account", "/developer", "/privacy"];
const WIDTHS = (process.argv[2] || "360,412,768,1024,1440").split(",").map(Number);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function connect(child: ReturnType<typeof spawn>) {
  const writable = child.stdio[3] as NodeJS.WritableStream;
  const readable = child.stdio[4] as NodeJS.ReadableStream;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  readable.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    for (;;) {
      const end = buffer.indexOf(0);
      if (end === -1) break;
      const raw = buffer.subarray(0, end).toString("utf8");
      buffer = buffer.subarray(end + 1);
      let message: any;
      try { message = JSON.parse(raw); } catch { continue; }
      const slot = pending.get(message.id);
      if (!slot) continue;
      pending.delete(message.id);
      if (message.error) slot.reject(new Error(message.error.message));
      else slot.resolve(message.result);
    }
  });
  function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      writable.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }
  return { send };
}

// Runs in the page. Only elements that actually stick out are reported, and an element
// whose parent already sticks out is skipped — otherwise one offender is reported once
// per ancestor and the real cause is buried.
const OVERFLOW_PROBE = `(() => {
  const limit = document.documentElement.clientWidth;
  const offenders = [];
  document.querySelectorAll("body *").forEach(node => {
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.right <= limit + 1) return;
    if (node.parentElement && node.parentElement.getBoundingClientRect().right > limit + 1) return;
    const name = node.tagName.toLowerCase() + (node.className && typeof node.className === "string"
      ? "." + node.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
    offenders.push({ name, over: Math.round(box.right - limit) });
  });
  return {
    viewport: limit,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: offenders.sort((a, b) => b.over - a.over).slice(0, 4),
  };
})()`;

const profileDir = path.join(tmpdir(), `cf-layout-${Date.now()}`);
let chrome: ReturnType<typeof spawn> | undefined;
let failures = 0;

try {
  const binary = CHROME_CANDIDATES.find(candidate => existsSync(candidate));
  if (!binary) throw new Error("No Chrome found.");

  chrome = spawn(binary, [
    `--user-data-dir=${profileDir}`,
    "--headless",
    "--disable-gpu",
    "--remote-debugging-pipe",
    "--no-first-run",
    "--no-default-browser-check",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });

  const cdp = connect(chrome);
  for (let attempt = 0; ; attempt += 1) {
    try { await cdp.send("Browser.getVersion"); break; } catch { if (attempt > 40) throw new Error("Chrome never answered"); await wait(250); }
  }

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);

  console.log(`\nChecking ${BASE} for horizontal overflow\n`);

  for (const width of WIDTHS) {
    // Device metrics rather than a window size: this is what a phone viewport does to
    // `width=device-width`, which a resized desktop window does not reproduce.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }, sessionId);
    for (const route of ROUTES) {
      await cdp.send("Page.navigate", { url: `${BASE}${route}` }, sessionId);
      await wait(1_800);
      const probe = await cdp.send("Runtime.evaluate", { expression: OVERFLOW_PROBE, returnByValue: true }, sessionId);
      const { scrollWidth, offenders } = probe.result.value as { scrollWidth: number; offenders: { name: string; over: number }[] };
      const overflowing = scrollWidth > width + 1;
      if (overflowing) failures += 1;
      const detail = overflowing
        ? `scrollWidth ${scrollWidth} (+${scrollWidth - width}px) — ${offenders.map(entry => `${entry.name} +${entry.over}`).join(", ") || "no single offender isolated"}`
        : "fits";
      console.log(`${overflowing ? " OVER " : "  OK  "} ${String(width).padStart(4)}px  ${route.padEnd(16)} ${detail}`);
    }
  }

  console.log(failures ? `\n${failures} route/width combination(s) overflow.\n` : `\nNo horizontal overflow at any tested width.\n`);
} catch (error) {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  failures += 1;
} finally {
  chrome?.kill();
}

process.exitCode = failures ? 1 : 0;
