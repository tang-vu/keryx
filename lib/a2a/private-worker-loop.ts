import type { createPrivateWorker } from "./private-worker";

type Worker = ReturnType<typeof createPrivateWorker>;
type Summary = Awaited<ReturnType<Worker["tick"]>> | { status: "tick-unavailable" | "stopped" };

function pause(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** No timer races an active tick. Shutdown wakes an idle wait and drains an ongoing
 * execution before returning. Process supervisors must allow enough shutdown time. */
export async function runPrivateWorkerLoop(worker: Worker, options: {
  signal: AbortSignal; once?: boolean; pollMs?: number; report: (summary: Summary) => void;
}) {
  const { signal, once, report } = options;
  const pollMs = options.pollMs ?? 5000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 1000 || pollMs > 60000) throw new Error("Invalid private worker poll interval");
  while (!signal.aborted) {
    let summary: Summary;
    try { summary = await worker.tick(signal); }
    catch { summary = { status: "tick-unavailable" }; }
    report(summary);
    if (once || signal.aborted) break;
    await pause(pollMs, signal);
  }
  report({ status: "stopped" });
}
