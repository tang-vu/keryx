import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import {
  appSecurityHeaders,
  CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN,
  contentSecurityPolicy,
  SCALAR_API_REFERENCE_SCRIPT_URL,
} from "./security-headers";

describe("application security headers", () => {
  it("blocks framing/plugins and limits wallet network destinations", () => {
    const csp = contentSecurityPolicy(true);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("https://gateway-api-testnet.circle.com");
    expect(csp).toContain("https://*.supabase.co");
    expect(csp).toContain(CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN);
    expect(csp).not.toContain("https://cdn.jsdelivr.net");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(false)).not.toContain("upgrade-insecure-requests");
  });

  it("allows Scalar's pinned entry point only in the API docs policy", () => {
    const docsCsp = contentSecurityPolicy(true, [SCALAR_API_REFERENCE_SCRIPT_URL]);
    const docsHeaders = appSecurityHeaders([SCALAR_API_REFERENCE_SCRIPT_URL]);

    expect(docsCsp).toContain(SCALAR_API_REFERENCE_SCRIPT_URL);
    expect(docsCsp).toContain(CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN);
    expect(docsHeaders).toContainEqual({
      key: "Content-Security-Policy",
      value: expect.stringContaining(SCALAR_API_REFERENCE_SCRIPT_URL),
    });
  });

  it("scopes the Scalar CDN override to /api/docs after the global rule", async () => {
    const rules = await nextConfig.headers?.();
    const globalRule = rules?.find((rule) => rule.source === "/(.*)");
    const docsRule = rules?.find((rule) => rule.source === "/api/docs");
    const globalCsp = globalRule?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;
    const docsCsp = docsRule?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(globalCsp).not.toContain(SCALAR_API_REFERENCE_SCRIPT_URL);
    expect(docsCsp).toContain(SCALAR_API_REFERENCE_SCRIPT_URL);
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
