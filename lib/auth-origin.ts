/** Cookie-write CSRF check against server-controlled deployment configuration.
 * Next may canonicalize request.url; request Host/forwarded headers confer no authority.
 * No environment, database or request body access belongs in this pure check. */
export function isConfiguredSameOrigin(request: Request, configuredBaseUrl: unknown): boolean {
  try {
    if (typeof configuredBaseUrl !== "string" || !/^https?:\/\//i.test(configuredBaseUrl) || /[\s\\\u0000-\u001f\u007f]/u.test(configuredBaseUrl)) return false;
    const base = new URL(configuredBaseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) return false;
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(origin).origin || origin !== base.origin) return false;
    const site = request.headers.get("sec-fetch-site");
    return site === null || site === "same-origin";
  } catch { return false; }
}
