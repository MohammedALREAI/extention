import { describe, expect, it } from "vitest";
import { applySecurityHeaders, productionContentSecurityPolicy } from "./_core/index";

describe("production security headers", () => {
  it("uses a narrow CSP while permitting the documented font, image, and analytics sources", () => {
    const policy = productionContentSecurityPolicy("https://analytics.example.test/umami");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("https://fonts.googleapis.com");
    expect(policy).toContain("https://analytics.example.test");
    expect(policy).not.toContain("script-src *");
  });

  it("attaches baseline anti-sniffing, referrer, embedding, and permissions policies", () => {
    const headers = new Map<string, string>();
    let advanced = false;
    applySecurityHeaders({} as never, { setHeader: (name: string, value: string) => headers.set(name, value) } as never, () => { advanced = true; });
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(advanced).toBe(true);
  });
});
