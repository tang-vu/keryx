import { readBoundedJson } from "../read-bounded-json";
import { parseNativeObligationInspection } from "./contracts";

/** Credential-only HTTPS inspection. No env-file, wallet, database, retries or redirects. */
export function createObligationClient(baseUrl: string, key: () => string | undefined, fetcher: typeof fetch = fetch) {
  let base: URL;
  try { base = new URL(baseUrl); } catch { throw new Error("Use the HTTPS deployment origin"); }
  if (base.protocol !== "https:" || base.origin !== baseUrl || base.username || base.password) throw new Error("Use the HTTPS deployment origin");
  return { read: async () => {
    try {
      const raw = key();
      if (!raw || !/^kx_live_[0-9a-f]{96}$/.test(raw)) throw new Error("Operator inspection refused or unavailable");
      const response = await fetcher(new URL("/api/operator/obligations", base), { method: "GET",
        headers: { Authorization: `Bearer ${raw}` }, redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Operator inspection refused or unavailable"); }
      return parseNativeObligationInspection(await readBoundedJson(response, 32_768));
    } catch { throw new Error("Operator inspection refused or unavailable"); }
  } };
}
