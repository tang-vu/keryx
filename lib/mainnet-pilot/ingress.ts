/** An isolated pilot instance denies unsupported API surfaces before route authority executes. */
export function pilotIngressDenied(request: Request, configuredOrigin: string | undefined): boolean {
  if (configuredOrigin === undefined) return false;
  try {
    const expected = new URL(configuredOrigin), url = new URL(request.url);
    if (expected.protocol !== "https:" || expected.origin !== configuredOrigin || expected.username || expected.password ||
        url.origin !== configuredOrigin) return true;
    if (url.pathname === "/api/health" && request.method === "GET") return false;
    return !/^\/api\/mainnet-pilot\/(?:ask|sign|grant(?:\/challenge)?|challenge|source\/0x[0-9a-f]{64}(?:\/item\/[^/]+(?:\/preview)?)?|cite\/0x[0-9a-f]{64})$/.test(url.pathname) ||
      !["GET", "POST", ...(url.pathname === "/api/mainnet-pilot/grant" ? ["DELETE"] : [])].includes(request.method);
  } catch { return true; }
}
