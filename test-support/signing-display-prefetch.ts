/** Only unrelated root-link RSC prefetches may be isolated from the idle signing observation. */
export const SIGNING_DISPLAY_PREFETCH_PATHS = Object.freeze([
  "/dashboard", "/operator", "/answers", "/sources", "/literature", "/market", "/integrations/mcp", "/pricing", "/about", "/quality",
  "/wanted", "/register", "/me/sources", "/me/asks", "/playground", "/research", "/dev",
  "/proof", "/economics", "/privacy", "/terms",
] as const);
export const SIGNING_DISPLAY_PREFETCH_LIMIT = 64;

export function signingDisplayPrefetchPath(request: {
  url: string; method: string; resourceType: string; navigation: boolean;
  headers: Readonly<Record<string, string | undefined>>;
}, origin: string): string | null {
  // Next16 sends RSC=1 and finite next-router-prefetch strategy values1/2/3.
  // Actual navigation, HTML/assets, API and credential-bearing URLs are never isolated.
  if (request.method !== "GET" || request.resourceType !== "fetch" || request.navigation || request.url.length > 2048
    || request.headers.rsc !== "1" || !["1", "2", "3"].includes(request.headers["next-router-prefetch"] ?? "")) return null;
  if (["authorization", "cookie", "payment-signature", "x-payment", "x-keryx-expected-wallet"]
    .some(name => request.headers[name] !== undefined)) return null;
  try {
    const url = new URL(request.url);
    if (url.origin !== origin || url.username || url.password || url.hash || request.url !== origin + url.pathname + url.search
      || !SIGNING_DISPLAY_PREFETCH_PATHS.some(path => path === url.pathname)
      || !/^\?_rsc=[A-Za-z0-9_-]{1,128}$/.test(url.search)) return null;
    return url.pathname;
  } catch { return null; }
}
