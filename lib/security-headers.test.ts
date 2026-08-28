import { describe, expect, it } from "vitest";
import { appSecurityHeaders, contentSecurityPolicy } from "./security-headers";

describe("application security headers", () => {
  it("blocks framing/plugins and limits wallet network destinations", () => {
    const csp = contentSecurityPolicy(true);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("https://gateway-api-testnet.circle.com");
    expect(csp).toContain("https://*.supabase.co");
    expect(csp).not.toContain("https://cdn.jsdelivr.net");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(false)).not.toContain("upgrade-insecure-requests");
  });

  it("ships transport, MIME, referrer, and permissions protections", () => {
    const keys = appSecurityHeaders().map((header) => header.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
      ]),
    );
  });
});
