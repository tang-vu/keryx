import { readBoundedJson } from "../read-bounded-json";
import { historyPageSchema, historyQueryString, type HistoryInput } from "./personal-history";

/** Key-only read client. No signer, cookies, redirects, retries or historical-store selectors. */
export function createHistoryClient(baseUrl: string, key: () => string | undefined, fetcher: typeof fetch = fetch) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("Use the HTTPS deployment origin");
  return { async read(input: HistoryInput = {}) {
    const raw = key();
    if (!raw || !/^kx_live_[0-9a-f]{96}$/.test(raw)) throw new Error("Configure an explicitly history-scoped KERYX_API_KEY");
    const url = new URL("/api/me/history", base); url.search = historyQueryString(input);
    const response = await fetcher(url, { method: "GET", headers: { Authorization: `Bearer ${raw}` }, credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Personal history request refused (${response.status})`); }
    return historyPageSchema.parse(await readBoundedJson(response, 2 * 1024 * 1024));
  } };
}
