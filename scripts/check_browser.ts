/**
 * Drives a real Chrome with the extension loaded and reports what it actually covered.
 *
 *   npx tsx scripts/check_browser.ts              # local page, remote images
 *   npx tsx scripts/check_browser.ts google       # a real Google image search
 *   npx tsx scripts/check_browser.ts <url>
 *
 * `npm run check:server` proves the server answers. This proves the other half: that
 * Chrome lets the extension reach it and that the boxes become masks on the page. The
 * two failures look identical from the toolbar, so they are worth separating.
 *
 * A throwaway profile is used, never the user's own Chrome.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

const SERVER = (process.env.CF_CHECK_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const TERM = process.env.CF_CHECK_TERM || "cat";
const argument = process.argv[2] || "local";
const target = argument === "local" ? `${SERVER}/eval/live-check.html?q=${TERM}`
  : argument === "google" ? `https://www.google.com/search?q=${TERM}&udm=2`
  : argument;

const profileDir = path.join(tmpdir(), `cf-check-profile-${Date.now()}`);
const extensionDir = path.resolve(import.meta.dirname, "..", "extension");

function snapshot() {
  return {
    schemaVersion: 1,
    revision: `browsercheck-${Date.now()}`,
    enabled: true,
    locale: "en",
    sourcePreference: `Do not show me: ${TERM}`,
    scope: { text: true, images: true },
    imageProtectionMode: "strict",
    blurIntensity: "auto",
    rules: [{ term: TERM, action: "blur" }],
    semantic: {
      endpoint: `${SERVER}/api/extension/semantic-evaluate`,
      visualEndpoint: `${SERVER}/api/extension/visual-localize`,
      token: process.env.CF_CHECK_TOKEN || "dev-local-bypass",
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    },
  };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Chrome derives an unpacked extension's id from its directory path: the first 16 bytes
 * of the SHA-256, with each hex digit mapped onto a-p. The path is hashed as the OS
 * spells it, which on Windows means UTF-16LE.
 */
function unpackedExtensionId(directory: string) {
  const encoded = Buffer.from(directory, process.platform === "win32" ? "utf16le" : "utf8");
  return createHash("sha256").update(encoded).digest("hex").slice(0, 32)
    .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
}

async function until<T>(what: string, attempt: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    // The last failure is kept: a bare "timed out" hides the reason it never succeeded.
    const value = await attempt().catch(error => { lastError = error; return undefined; });
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}${lastError ? ` — last error: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ""}`);
    }
    await wait(250);
  }
}

/**
 * A minimal CDP client speaking the pipe transport: NUL-delimited JSON on file
 * descriptors 3 and 4.
 *
 * The websocket transport would be simpler, but Chrome 137 removed `--load-extension`
 * from ordinary startup to stop malware silently side-loading. It survives only
 * alongside `--enable-unsafe-extension-debugging`, and that in turn is honoured only
 * with `--remote-debugging-pipe` — a debugging port is explicitly not enough. So the
 * pipe is not a preference here; it is the only way to drive an unpacked extension on a
 * current Chrome.
 */
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
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
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
  return { send, close: () => { try { writable.end(); } catch { /* already gone */ } } };
}

type CdpTarget = { targetId: string; type: string; url: string; title: string };

async function targets(cdp: ReturnType<typeof connect>): Promise<CdpTarget[]> {
  return (await cdp.send("Target.getTargets")).targetInfos;
}

/** Opens a tab and returns a session attached to it. */
async function openTab(cdp: ReturnType<typeof connect>, url: string) {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  return { targetId, sessionId };
}

async function evaluate(cdp: ReturnType<typeof connect>, sessionId: string, expression: string) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluation failed");
  return result.result?.value;
}

// The probe runs in the page. A mask layer is a sibling of the image, so the question
// "was this image covered, and with how many object masks" is answered from the DOM
// rather than from anything the extension reports about itself.
const PROBE = `(() => {
  const rows = Array.from(document.images).map(image => {
    const layer = image.parentElement?.querySelector(":scope > .cf-image-mask-layer");
    return {
      id: image.id || image.currentSrc.slice(-40),
      width: image.naturalWidth,
      height: image.naturalHeight,
      objectMasks: layer ? layer.querySelectorAll(".cf-object-mask").length : 0,
      wholeCover: Boolean(layer && layer.querySelector(".cf-image-review-cover, .cf-image-pending-cover")),
    };
  });
  return { rows, inlineMasks: document.querySelectorAll(".cf-inline-mask").length };
})()`;

let chrome: ReturnType<typeof spawn> | undefined;
try {
  const binary = CHROME_CANDIDATES.find(candidate => existsSync(candidate));
  if (!binary) throw new Error(`No Chrome found. Looked in:\n  ${CHROME_CANDIDATES.join("\n  ")}`);
  mkdirSync(profileDir, { recursive: true });

  console.log(`\nChrome    ${binary}`);
  console.log(`Extension ${extensionDir}`);
  console.log(`Target    ${target}\n`);

  chrome = spawn(binary, [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`,
    // Both are required together on Chrome 137+; see the note on connect().
    "--enable-unsafe-extension-debugging",
    "--remote-debugging-pipe",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-backgrounding-occluded-windows",
    "--window-size=1280,1000",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });

  const cdp = connect(chrome);
  await until("Chrome's debugging pipe", async () => (await cdp.send("Browser.getVersion")).product);

  // Discovery is unreliable here: a fresh profile already carries Chrome's own component
  // extensions, and an MV3 service worker may be dormant and absent from the target list
  // entirely. The id of an unpacked extension is a function of its path, so it is
  // computed and then confirmed by the options page actually loading.
  const extensionId = unpackedExtensionId(extensionDir);
  console.log(`  extension id ${extensionId}`);

  // Written through the extension's own options page, so this is the import path a user
  // takes, not a shortcut around it.
  const options = await openTab(cdp, `chrome-extension://${extensionId}/options.html`);
  await until("the options page", async () =>
    (await evaluate(cdp, options.sessionId, `Boolean(globalThis.CFPolicy)`)) === true ? true : undefined)
    .catch(async error => {
      const listed = (await targets(cdp)).map(entry => `    ${entry.type.padEnd(16)} ${entry.url.slice(0, 90)}`).join("\n");
      // Chrome opens chrome://extensions by itself when a load fails, and the reason is
      // rendered inside its shadow DOM rather than surfaced through the protocol.
      const state = await evaluate(cdp, options.sessionId,
        `({ href: location.href, ready: document.readyState, text: (document.body?.innerText || "").slice(0, 200) })`).catch(() => undefined);
      throw new Error(`${error.message}\n  Options page: ${JSON.stringify(state)}\n  Targets Chrome reports:\n${listed}`);
    });
  const saved = await evaluate(cdp, options.sessionId,
    `globalThis.CFPolicy.savePolicy(${JSON.stringify(snapshot())}).then(policy => policy.rules.map(rule => rule.term).join(","))`);
  console.log(`  policy stored, blocking: ${saved}`);
  await cdp.send("Target.closeTarget", { targetId: options.targetId });

  const page = await openTab(cdp, target);
  await cdp.send("Page.enable", {}, page.sessionId);
  console.log(`  page open, waiting for detection…`);

  // Detection is a network round trip per batch; poll rather than guess a single sleep.
  let probe = await until("a mask to appear", async () => {
    const value = await evaluate(cdp, page.sessionId, PROBE);
    const covered = value?.rows?.some((row: any) => row.objectMasks > 0 || row.wholeCover);
    return covered ? value : undefined;
  }, 60_000).catch(async () => evaluate(cdp, page.sessionId, PROBE));

  // Give any second batch time to land before reporting.
  await wait(6_000);
  probe = await evaluate(cdp, page.sessionId, PROBE);

  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, page.sessionId);
  const shotPath = path.resolve(process.cwd(), "browser-check.png");
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"));

  console.log(`\n  image                                    natural   object masks   whole cover`);
  (probe?.rows ?? []).forEach((row: any) => {
    console.log(`  ${String(row.id).padEnd(40)} ${`${row.width}x${row.height}`.padEnd(9)} ${String(row.objectMasks).padEnd(14)} ${row.wholeCover ? "yes" : "no"}`);
  });
  console.log(`\n  inline text masks: ${probe?.inlineMasks ?? 0}`);
  console.log(`  screenshot: ${shotPath}\n`);

  cdp.close();
} catch (error) {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  chrome?.kill();
  await wait(1_500);
  // Chrome keeps a memory-mapped metrics file open briefly after exit; a profile left in
  // the temp directory is not worth failing the run over.
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    console.log(`  (left ${profileDir} behind — Chrome still had it open)`);
  }
}
