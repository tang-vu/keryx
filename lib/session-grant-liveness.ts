import { readBoundedJson } from "./read-bounded-json";
import type { createSessionGrantClock } from "./session-grant-time";

/** Read-only advisory UI watcher. Each registration owns a stable clock and lifetime. */
export function watchSessionGrantClock(clock: ReturnType<typeof createSessionGrantClock>, current: () => boolean,
  expired: () => void, unavailable: () => void) {
  const monotonicNow = performance.now.bind(performance);
  let timer: ReturnType<typeof setTimeout>;
  let pending: AbortController | undefined;
  let disposed = false;
  const live = () => !disposed && current();
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { if (live()) expired(); }, clock.remaining(monotonicNow())); };
  const revalidate = async () => {
    if (pending || !live() || document.visibilityState !== "visible") return;
    pending = new AbortController(); const controller = pending, started = monotonicNow();
    const deadline = setTimeout(() => controller.abort(), 5000);
    // Race transport/body against abort even when a transport ignores cancellation.
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Session lookup interrupted")); });
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    try {
      const body = await Promise.race([aborted, (async () => {
        const res = await fetch("/api/session/grant", { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
        const value = await readBoundedJson(res, 8192); controller.signal.throwIfAborted();
        if (!res.ok || !value || typeof value !== "object" || !("active" in value) || value.active !== true) throw new Error();
        return value;
      })()]);
      if (!live()) return;
      const elapsed = monotonicNow() - started;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 5000) throw new Error("Session lookup deadline exceeded");
      clock.clamp(body, started, monotonicNow()); schedule();
    } catch { if (live()) unavailable(); }
    finally { clearTimeout(deadline); controller.signal.removeEventListener("abort", rejectAbort); if (pending === controller) pending = undefined; }
  };
  schedule();
  const focused = () => { void revalidate(); };
  window.addEventListener("focus", focused); document.addEventListener("visibilitychange", focused);
  return () => { disposed = true; clearTimeout(timer); pending?.abort(); window.removeEventListener("focus", focused); document.removeEventListener("visibilitychange", focused); };
}
