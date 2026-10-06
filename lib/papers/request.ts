import type { PaperFilters } from "./types";
import { normalizeDoi } from "../scholarly/doi";
import { paperLookupIntent } from "./intent";

export function parsePaperRequest(params: URLSearchParams): { filters: PaperFilters; live: boolean } {
  const bounds = { q: 120, author: 120, year: 4, doi: 200, search: 1 } as const;
  for (const [name, max] of Object.entries(bounds)) {
    if (params.getAll(name).length > 1 || (params.get(name)?.length ?? 0) > max) throw new Error("Invalid paper filters");
  }
  const q = params.get("q")?.trim() ?? "", author = params.get("author")?.trim();
  const year = params.get("year")?.trim(), doiInput = params.get("doi")?.trim();
  const doi = doiInput ? normalizeDoi(doiInput) : undefined, search = params.get("search");
  if (year && (!/^\d{4}$/.test(year) || Number(year) < 1000 || Number(year) > 2999)
    || doiInput && !doi || search !== null && search !== "0" && search !== "1") throw new Error("Invalid paper filters");
  const live = search === "1";
  if (live && !doi && !/[\p{L}\p{N}]{3}/u.test(q)) throw new Error("Enter a paper title, topic or identifier");
  if (live) paperLookupIntent(doi ?? q);
  return { filters: { q, ...(author ? { author } : {}), ...(year ? { year } : {}), ...(doi ? { doi } : {}) }, live };
}

/** Bounded process-local RAM only. Shared global admission limits IP-header rotation. */
export function createPaperSearchLimiter(now = Date.now) {
  let globalWindow = { until: 0, used: 0 };
  const callers = new Map<string, { until: number; used: number }>();
  return (caller: string): number => {
    const time = now();
    if (time >= globalWindow.until) { globalWindow = { until: time + 60000, used: 0 }; callers.clear(); }
    if (globalWindow.used >= 6) return Math.max(1, Math.ceil((globalWindow.until - time) / 1000));
    const key = caller.slice(0, 128), window = callers.get(key) ?? { until: globalWindow.until, used: 0 };
    if (window.used >= 3) return Math.max(1, Math.ceil((window.until - time) / 1000));
    window.used++; callers.set(key, window); globalWindow.used++;
    return 0;
  };
}
