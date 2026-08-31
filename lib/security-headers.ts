/**
 * Cloudflare injects a versioned `/beacon.min.js/<hash>` URL for automatic Web Analytics setup,
 * so the origin (rather than one unversioned path) must be allowed.
 */
export const CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN =
  "https://static.cloudflareinsights.com";

/** Scalar's Next adapter emits this standalone browser bundle in the API docs HTML. */
export const SCALAR_API_REFERENCE_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.67.0/dist/browser/standalone.js";

export function contentSecurityPolicy(
  production = process.env.NODE_ENV === "production",
  additionalScriptSources: readonly string[] = [],
): string {
  const script = [
    "'self'",
    "'unsafe-inline'",
    CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN,
    ...additionalScriptSources,
    ...(production ? [] : ["'unsafe-eval'"]),
  ];
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    [
      "connect-src 'self'",
      "https://rpc.testnet.arc.network",
      "https://gateway-api-testnet.circle.com",
      "https://*.supabase.co",
      "wss://*.supabase.co",
      "https://*.walletconnect.com",
      "wss://*.walletconnect.com",
      "https://*.walletconnect.org",
      "wss://*.walletconnect.org",
      "https://*.reown.com",
      "wss://*.reown.com",
      "https://*.metamask.io",
      "wss://*.metamask.io",
    ].join(" "),
    "worker-src 'self' blob:",
    "frame-src 'self' https://*.walletconnect.com https://*.walletconnect.org https://*.metamask.io",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * Static CSP keeps the answer archive cacheable. Next's App Router requires every nonce-protected
 * page to render dynamically, so this baseline permits framework inline bootstrap scripts while
 * restricting their network destinations and all other resource classes.
 */
export function appSecurityHeaders(
  additionalScriptSources: readonly string[] = [],
): { key: string; value: string }[] {
  return [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(undefined, additionalScriptSources),
    },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
}
