import { readBoundedJson } from "../read-bounded-json";

/** Worker authentication always uses the browser's same-origin cookie. The page supplies no
 * token, origin, network, callback URL, or trusted payout fields to this transport.
 */
export async function sessionJson(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const liabilities = /^\/api\/session\/withdraw\/payments\?sessAddr=0x[0-9a-f]{40}&grantEpoch=[0-9a-f-]{36}(?:&afterNonce=0x[0-9a-f]{64})?$/.test(path);
  const cashout = /^\/api\/session\/withdraw\/(?:prepare|authorize|cancel|abort|submit|complete|0x[0-9a-f]{64})$/.test(path);
  if (!/^\/api\/session\/grant(?:\/challenge)?$/.test(path) && !liabilities && !cashout &&
    !/^\/api\/ask\/challenge$/.test(path) && path !== "/api/sources" &&
    !/^\/api\/source\/[^/?]+\/item\/[^/?]+\/preview\?version=[^&?#]+$/.test(path)) throw new Error("Session API refused");
  try {
    const response = await fetch(path, { method, credentials: "same-origin", redirect: "error", cache: "no-store",
      headers: { accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      await response.body?.cancel(); throw new Error();
    }
    return await readBoundedJson(response, liabilities ? 1048576 : path === "/api/sources" ? 262144 : cashout ? 65536 : 16384);
  } catch { throw new Error("Authenticated session API unavailable"); }
}
