import { parsePublicMaintenanceStatus, STATUS_PATH, type MaintenanceStatus } from "./public-status";

export const STATUS_READ_LIMIT = 11;
export const STATUS_LIFETIME_MS = 10 * 60_000;
export const STATUS_INTERVAL_MS = 60_000;
export const STATUS_TIMEOUT_MS = 5_000;
export const STATUS_BYTES_LIMIT = 8192;
export interface StatusReadBudget { startedAt: number | null; reads: number; stopped: boolean }
export type StatusObservation = { kind: "current"; status: MaintenanceStatus } | { kind: "unavailable" } | { kind: "finished" };

async function readStatus(fetcher: typeof fetch, signal: AbortSignal): Promise<MaintenanceStatus> {
  const response = await fetcher(STATUS_PATH, { method: "GET", cache: "no-store", credentials: "omit", redirect: "error", signal });
  if (response.status !== 200 || response.redirected || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? ""))
    throw Error("Public maintenance status unavailable");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > STATUS_BYTES_LIMIT)) throw Error("Public status exceeds bound");
  if (!response.body) throw Error("Public maintenance status unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > STATUS_BYTES_LIMIT) throw Error("Public status exceeds bound");
      chunks.push(part.value);
    }
  } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  const status = parsePublicMaintenanceStatus(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
  if (!status) throw Error("Invalid public maintenance status");
  return status;
}

/** Finite public GET observation, never a research/payment retry or a readiness decision. */
export function observeMaintenanceStatus(budget: StatusReadBudget, observe: (value: StatusObservation) => void,
  options: { fetcher?: typeof fetch; visible?: () => boolean; now?: () => number } = {}): () => void {
  const fetcher = options.fetcher ?? fetch;
  const visible = options.visible ?? (() => document.visibilityState === "visible");
  // Monotonic elapsed time bounds observation only. Public state comes from the server's checkedAt.
  const now = options.now ?? (() => performance.now());
  budget.startedAt ??= now();
  if (budget.stopped) return () => {};
  let active = true;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const remaining = () => STATUS_LIFETIME_MS - (now() - budget.startedAt!);
  const finish = (kind: "unavailable" | "finished") => {
    if (!active || budget.stopped) return;
    budget.stopped = true;
    clearTimeout(pending); clearTimeout(timeout); clearTimeout(lifetime); controller?.abort();
    observe({ kind });
  };
  const lifetime = setTimeout(() => finish("finished"), Math.max(0, remaining()));
  const read = async () => {
    if (!active || budget.stopped) return;
    if (remaining() <= 0 || budget.reads >= STATUS_READ_LIMIT) { finish("finished"); return; }
    if (!visible()) { pending = setTimeout(() => void read(), STATUS_INTERVAL_MS); return; }
    budget.reads += 1;
    controller = new AbortController();
    try {
      const status = await Promise.race([readStatus(fetcher, controller.signal), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller?.abort(); reject(Error("Public status timed out")); }, STATUS_TIMEOUT_MS);
      })]);
      if (!active || budget.stopped) return;
      observe({ kind: "current", status });
      if (budget.reads >= STATUS_READ_LIMIT || remaining() <= 0) finish("finished");
      else pending = setTimeout(() => void read(), STATUS_INTERVAL_MS);
    } catch { if (active && !budget.stopped) finish("unavailable"); }
    finally { clearTimeout(timeout); }
  };
  if (!budget.stopped) pending = setTimeout(() => void read(), 0);
  return () => { active = false; clearTimeout(pending); clearTimeout(timeout); clearTimeout(lifetime); controller?.abort(); };
}
