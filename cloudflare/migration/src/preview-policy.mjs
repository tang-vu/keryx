const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function authorized(request, secret) {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(secret)) return false;
  const supplied = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (supplied.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

/** Compatibility preview has no payment, production storage, or source-write authority. */
export async function previewResponse(request, env, next, sourceCommit) {
  const url = new URL(request.url);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname).toLowerCase(); }
  catch { return new Response("Invalid path", { status: 400, headers: privateHeaders }); }
  if (url.pathname === "/__migration/health" && ["GET", "HEAD"].includes(request.method)) {
    const response = Response.json({ name: "keryx", deployment: "cloudflare-compatibility-preview", sourceCommit,
      network: "arcTestnet", productionReady: false, payments: "disabled", canonicalStorage: "not-migrated" },
    { headers: privateHeaders });
    return request.method === "HEAD" ? new Response(null, { headers: response.headers }) : response;
  }
  if (!authorized(request, env.MIGRATION_PREVIEW_TOKEN)) {
    return new Response("Private migration preview", { status: 401, headers: privateHeaders });
  }
  if (!["GET", "HEAD"].includes(request.method) || pathname.startsWith("/api/") || pathname === "/api"
    || pathname === "/mcp" || pathname.startsWith("/mcp/") || pathname.includes("%")) {
    return Response.json({ error: "migration_preview_incomplete", payments: "disabled" },
      { status: 503, headers: privateHeaders });
  }
  const response = await next();
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
  return new Response(request.method === "HEAD" ? null : response.body,
    { status: response.status, statusText: response.statusText, headers });
}
