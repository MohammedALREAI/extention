import { describe, expect, it, vi } from "vitest";
import { fetchRemoteImage, isBlockedAddress, MAX_REMOTE_IMAGE_BYTES } from "./imageFetch";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageResponse(bytes: Buffer, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "image/png", ...headers }),
    body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new Uint8Array(bytes) })), cancel: async () => undefined }; } },
  } as unknown as Response;
}

describe("remote image address policy", () => {
  it("blocks every address a page could use to reach inside the network", () => {
    // The cloud metadata endpoint is the one that turns SSRF into credential theft.
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.1.2.3")).toBe(true);
    expect(isBlockedAddress("172.16.0.1")).toBe(true);
    expect(isBlockedAddress("172.31.255.255")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
    expect(isBlockedAddress("100.64.0.1")).toBe(true);
    expect(isBlockedAddress("0.0.0.0")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fd00::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    // An IPv4-mapped IPv6 address must not slip past the IPv4 rules.
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("not-an-address")).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("172.15.0.1")).toBe(false);
    expect(isBlockedAddress("172.32.0.1")).toBe(false);
    expect(isBlockedAddress("2606:2800::1")).toBe(false);
  });
});

describe("fetching an image a page referenced", () => {
  it("refuses plain http and non-URLs outright", async () => {
    const never = vi.fn();
    expect(await fetchRemoteImage("http://example.test/a.png", never as never)).toEqual({ error: "not_https" });
    expect(await fetchRemoteImage("not a url", never as never)).toEqual({ error: "not_https" });
    expect(never).not.toHaveBeenCalled();
  });

  it("refuses a literal private address without connecting", async () => {
    const never = vi.fn();
    expect(await fetchRemoteImage("https://169.254.169.254/latest/meta-data/", never as never)).toEqual({ error: "blocked_address" });
    expect(never).not.toHaveBeenCalled();
  });

  it("re-checks the address after a redirect", async () => {
    // A public host that bounces to the metadata service is the classic bypass.
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 302,
      headers: new Headers({ location: "https://169.254.169.254/latest/meta-data/" }),
    }) as unknown as Response);
    expect(await fetchRemoteImage("https://93.184.216.34/redirect", fetchImpl as never)).toEqual({ error: "blocked_address" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a body that grows past the cap even when content-length lied", async () => {
    const oversized = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png", "content-length": "10" }),
      body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(MAX_REMOTE_IMAGE_BYTES + 1) }), cancel: async () => undefined }) },
    } as unknown as Response;
    expect(await fetchRemoteImage("https://93.184.216.34/big.png", (async () => oversized) as never)).toEqual({ error: "too_large" });
  });

  it("refuses a response that is not an image", async () => {
    const html = { ok: true, status: 200, headers: new Headers({ "content-type": "text/html" }), body: { getReader: () => ({ read: async () => ({ done: true }), cancel: async () => undefined }) } } as unknown as Response;
    expect(await fetchRemoteImage("https://93.184.216.34/page", (async () => html) as never)).toEqual({ error: "not_an_image" });
  });

  it("returns the bytes for an ordinary public image", async () => {
    const result = await fetchRemoteImage("https://93.184.216.34/dog.png", (async () => imageResponse(png)) as never);
    expect(result).toEqual({ bytes: png, mime: "image/png" });
  });

  it("identifies itself, since a bare fetch sends no User-Agent at all", async () => {
    // Large CDNs answer an absent User-Agent with a 4xx. That read as "unreachable", and
    // the pipeline then handed the model a URL instead of pixels — a silent no-match.
    const impl = vi.fn(async () => imageResponse(png));
    await fetchRemoteImage("https://93.184.216.34/dog.png", impl as never);
    const headers = impl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["user-agent"]).toContain("ContentFirewall");
    expect(headers.accept).toContain("image/");
  });
});
