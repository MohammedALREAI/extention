import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_REMOTE_IMAGE_BYTES = 6 * 1024 * 1024;
export const REMOTE_IMAGE_TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 3;

export type RemoteImageFailure = { error: "not_https" | "blocked_address" | "too_large" | "unreachable" | "not_an_image" };
export type RemoteImage = { bytes: Buffer; mime: string };

/**
 * Sent on every hop. A bare fetch carries no User-Agent, and large CDNs — Wikimedia
 * among them — answer that with a 4xx, so an image any browser renders came back
 * "unreachable" and the pipeline silently fell back to handing the model a URL.
 */
const REQUEST_HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; ContentFirewall/1.0; +https://github.com/content-firewall)",
  // JPEG and PNG first on purpose: a CDN offered AVIF answers with AVIF, which is both
  // slower to decode and the format most likely to be missing from a sharp build.
  accept: "image/jpeg,image/png,image/webp,image/*;q=0.8",
} as const;

/**
 * Addresses that must never be reachable through a URL a web page supplied.
 * Loopback, link-local (including the cloud metadata endpoint at 169.254.169.254),
 * every private range, and carrier-grade NAT.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return true;
  if (family === 6) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1") return true;
    if (value.startsWith("fe80") || value.startsWith("fc") || value.startsWith("fd")) return true;
    // ::ffff:10.0.0.1 and friends map straight back onto the IPv4 rules below.
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isBlockedAddress(mapped[1]) : false;
  }
  const [a, b] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

async function resolvesToAllowedAddress(hostname: string) {
  // A literal address needs no lookup; a name must be resolved and judged before we
  // connect, or the check is only inspecting a string.
  if (isIP(hostname)) return !isBlockedAddress(hostname);
  try {
    const results = await lookup(hostname, { all: true });
    return results.length > 0 && results.every(result => !isBlockedAddress(result.address));
  } catch {
    return false;
  }
}

async function readBounded(response: Response): Promise<Buffer | undefined> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REMOTE_IMAGE_BYTES) return undefined;
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Counted while streaming: a server that lies about content-length must still be
  // stopped before it fills memory.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REMOTE_IMAGE_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
}

/**
 * Fetches an image the extension referenced by URL, so a crop can be taken from it.
 * Every hop is re-checked: a permitted host may redirect to a forbidden address.
 */
export async function fetchRemoteImage(url: string, fetchImpl: typeof fetch = fetch): Promise<RemoteImage | RemoteImageFailure> {
  let target = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return { error: "not_https" };
    }
    if (parsed.protocol !== "https:") return { error: "not_https" };
    if (!(await resolvesToAllowedAddress(parsed.hostname))) return { error: "blocked_address" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_IMAGE_TIMEOUT_MS);
    try {
      const response = await fetchImpl(parsed.toString(), { redirect: "manual", signal: controller.signal, headers: REQUEST_HEADERS });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { error: "unreachable" };
        target = new URL(location, parsed).toString();
        continue;
      }
      if (!response.ok) return { error: "unreachable" };
      const mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!mime.startsWith("image/")) return { error: "not_an_image" };
      const bytes = await readBounded(response);
      if (!bytes?.length) return { error: "too_large" };
      return { bytes, mime };
    } catch {
      return { error: "unreachable" };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { error: "unreachable" };
}
