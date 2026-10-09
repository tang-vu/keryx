import { parseNativeObligationInspection } from "./contracts";
import { configuredObligationReader, isObligationReader, type ObligationReader } from "./reader";

export interface ObligationRouteDependencies {
  reader(): ObligationReader | null;
  key(raw: string): Promise<{ walletAddress: string; scopes: string | null } | null>;
  inspect(reader: ObligationReader): Promise<unknown>;
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: {
  "Cache-Control": "private, no-store", "Vary": "Authorization", "X-Content-Type-Options": "nosniff" } });
const denied = () => json({ error: "inspection_unavailable" }, 401);

/** Existing API-key auth lookup/last-used can occur before delegation is known.
 * New private inspection hydration/reads occur only after both scope and exact reader.
 * Bearer only; no cookie, public auth fallback, request JSON or custody selectors. */
export function createObligationRoute(deps: ObligationRouteDependencies) {
  return async (request: Request) => {
    let reader: ObligationReader | null;
    try { reader = deps.reader(); } catch { return denied(); }
    const header = request.headers.get("authorization");
    if (!reader || !header || !/^Bearer kx_live_[0-9a-f]{96}$/.test(header)) return denied();
    let key;
    try { key = await deps.key(header.slice(7)); } catch { return denied(); }
    if (!key || !isObligationReader(reader, key.walletAddress.toLowerCase(), key.scopes?.split(",").map(s => s.trim()))) return denied();
    let latest;
    try { latest = deps.reader(); } catch { return denied(); }
    if (!latest || latest.wallet !== reader.wallet || latest.role !== reader.role) return denied();
    if (new URL(request.url).search || request.body !== null) return json({ error: "invalid_inspection_request" }, 400);
    try {
      const value = parseNativeObligationInspection(await deps.inspect(reader));
      let after;
      try { after = deps.reader(); } catch { return denied(); }
      if (!after || after.wallet !== reader.wallet || after.role !== reader.role) return denied();
      const p = value.projection;
      if (value.readerWallet !== reader.wallet || p.scope.custodyRole !== `${reader.role}-hosted`) throw new Error();
      return json(value);
    } catch { return json({ error: "inspection_unavailable" }, 503); }
  };
}
export { configuredObligationReader };
