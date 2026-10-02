/** Fixed same-origin API only; cookie authority never comes from page-supplied headers. */
export async function pilotJson(path: string, method = "GET", body?: unknown): Promise<unknown> {
  if (!/^\/api\/mainnet-pilot\/(grant(?:\/challenge)?|challenge|sign)$/.test(path) &&
      !/^\/api\/mainnet-pilot\/source\/0x[0-9a-f]{64}\/item\/[^/?#]+\/preview\?version=sha256%3A[0-9a-f]{64}$/.test(path)) throw new Error("pilot API refused");
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, { method, credentials: "same-origin", redirect: "error", cache: "no-store",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json") || !response.body) throw new Error();
    const reader = response.body.getReader(); let size = 0, text = ""; const decoder = new TextDecoder();
    try {
      while (true) { const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength; if (size > 8192) throw new Error(); text += decoder.decode(part.value, { stream: true }); }
      text += decoder.decode(); return JSON.parse(text);
    } finally { await reader.cancel(); }
  } catch { throw new Error("authenticated pilot API unavailable"); }
  finally { clearTimeout(timeout); controller.abort(); }
}
