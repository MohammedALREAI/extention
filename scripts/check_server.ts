/**
 * Answers one question: is this server actually set up, end to end?
 *
 *   npx tsx scripts/check_server.ts
 *   npx tsx scripts/check_server.ts http://localhost:3001
 *
 * Every check reports the real failure text rather than a generic status code, because
 * the HTTP surface collapses every configuration fault into the same 502.
 */
import "dotenv/config";
import { detectImages } from "../server/visualPipeline";
import { listLLMModels } from "../server/_core/llm";
import { orderedModels, routePrefixes, type ModelRouteName } from "../server/modelRouter";

const baseUrl = (process.argv[2] || process.env.CF_CHECK_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
// An unmistakable photo of one cat, from a host that serves automated clients. Wikimedia
// answers this fetch with a 400, which made a healthy server look broken.
const PROBE_IMAGE = "https://images.pexels.com/photos/45201/kitty-cat-kitten-pet-45201.jpeg?auto=compress&cs=tinysrgb&w=640";
const PROBE_TERM = "cat";

type Check = { name: string; ok: boolean; detail: string };
const results: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name.padEnd(34)} ${detail}`);
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

console.log(`\nChecking ${baseUrl}\n`);

// 1. Gateway credentials. Presence only — the value is never printed.
const gatewayUrl = process.env.BUILT_IN_FORGE_API_URL?.trim();
const gatewayKey = process.env.BUILT_IN_FORGE_API_KEY?.trim();
record("1. Gateway configured", Boolean(gatewayUrl && gatewayKey),
  `${gatewayUrl || "BUILT_IN_FORGE_API_URL unset"}, key ${gatewayKey ? `set (${gatewayKey.length} chars)` : "UNSET"}`);

// 2. Catalog reachable, and every route resolves to a real model id.
let catalog: Awaited<ReturnType<typeof listLLMModels>>["data"] = [];
try {
  catalog = (await listLLMModels()).data;
  record("2. Model catalog reachable", catalog.length > 0, `${catalog.length} model(s) offered`);
} catch (error) {
  record("2. Model catalog reachable", false, reason(error));
}

if (catalog.length) {
  (["visual", "semantic"] as ModelRouteName[]).forEach(route => {
    const matched = orderedModels(catalog, routePrefixes(route));
    record(`3. Route "${route}" resolves`, matched.length > 0,
      matched.length ? matched.join(", ") : `no catalog id matches ${routePrefixes(route).join(", ")}`);
  });
}

// 4. The pipeline itself, called directly. This is the check that distinguishes "the
// server is up" from "the server can actually detect something".
const startedAt = Date.now();
try {
  const detections = await detectImages({
    images: [{ id: "probe", url: PROBE_IMAGE, width: 320, height: 428, context: "" }],
    sourcePreference: `Do not show me: ${PROBE_TERM}`,
    rules: [{ term: PROBE_TERM, action: "blur" }],
    effort: "thorough",
    deadlineMs: 15_000,
  });
  const boxes = detections[0]?.boxes ?? [];
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  record("4. Detection pipeline", boxes.length > 0,
    boxes.length
      ? `${boxes.length} box(es) for "${PROBE_TERM}" in ${seconds}s — ${boxes.map(box => `${box.label}@${box.confidence}`).join(", ")}`
      : `no box for a clear ${PROBE_TERM} photo in ${seconds}s (status: ${detections[0]?.status ?? "none"})`);
} catch (error) {
  record("4. Detection pipeline", false, `${reason(error)} (after ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
}

// 5. The HTTP surface the extension actually talks to.
async function probeHttp(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.text() };
}

try {
  const { status } = await probeHttp("/");
  record("5. Web app responds", status === 200, `HTTP ${status}`);
} catch (error) {
  record("5. Web app responds", false, `${reason(error)} — is the server running?`);
}

try {
  const { status, body } = await probeHttp("/api/extension/visual-localize", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.CF_CHECK_TOKEN || "dev-local-bypass"}` },
    body: JSON.stringify({ rules: [PROBE_TERM], images: [{ id: "probe", url: PROBE_IMAGE, width: 320, height: 428 }] }),
  });
  const boxes = status === 200 ? (JSON.parse(body)[0]?.boxes ?? []) : [];
  record("6. Extension endpoint", status === 200 && boxes.length > 0,
    status === 200 ? `HTTP 200, ${boxes.length} box(es)` : `HTTP ${status} ${body.slice(0, 160)}`);
} catch (error) {
  record("6. Extension endpoint", false, reason(error));
}

// 7. The preflight Chrome actually sends from a search page to a loopback server. A pass
// here is the difference between the extension reaching the server and the request being
// dropped inside the browser with nothing to see server-side.
try {
  const response = await fetch(`${baseUrl}/api/extension/visual-localize`, {
    method: "OPTIONS",
    headers: {
      origin: "https://www.google.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type",
      "access-control-request-private-network": "true",
    },
  });
  const allowOrigin = response.headers.get("access-control-allow-origin");
  const allowPrivate = response.headers.get("access-control-allow-private-network");
  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(baseUrl);
  const ok = response.status === 204 && allowOrigin === "https://www.google.com" && (!isLoopback || allowPrivate === "true");
  record("7. Browser preflight (CORS+PNA)", ok,
    ok ? `HTTP 204, origin echoed${isLoopback ? ", private network allowed" : ""}`
       : `HTTP ${response.status}, allow-origin ${allowOrigin ?? "missing"}, allow-private-network ${allowPrivate ?? "MISSING — Chrome will drop the request"}`);
} catch (error) {
  record("7. Browser preflight (CORS+PNA)", false, reason(error));
}

const failed = results.filter(check => !check.ok);
console.log(failed.length
  ? `\n${failed.length} check(s) failed. Fix the first one — the later ones depend on it.\n`
  : `\nAll ${results.length} checks passed. The server is set up.\n`);
process.exit(failed.length ? 1 : 0);
