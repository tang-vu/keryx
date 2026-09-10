import type { createPrivateWorker } from "./private-worker";
import type { createPrivateResultRecovery } from "./private-result-recovery";

type Worker = ReturnType<typeof createPrivateWorker>;
type Recovery = ReturnType<typeof createPrivateResultRecovery>;
type Summary = Awaited<ReturnType<Worker["tick"]>> | Awaited<ReturnType<Recovery["tick"]>> | { status: "tick-unavailable" | "stopped" };

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
  signal: AbortSignal; once?: boolean; pollMs?: number; recovery?: Recovery; report: (summary: Summary) => void;
}) {
  const { signal, once, report } = options;
  const pollMs = options.pollMs ?? 5000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 1000 || pollMs > 60000) throw new Error("Invalid private worker poll interval");
  try { while (!signal.aborted) {
    let summary: Summary;
    try {
      if (options.recovery) {
        const recovered = await options.recovery.tick(signal);
        report(recovered);
        if (!recovered.ready || signal.aborted) {
          if (once || signal.aborted) break;
          await pause(pollMs, signal);
          continue;
        }
      }
      summary = await worker.tick(signal);
    }
    catch { summary = { status: "tick-unavailable" }; }
    report(summary);
    if (once || signal.aborted) break;
    await pause(pollMs, signal);
  } } finally { await options.recovery?.close(); }
  report({ status: "stopped" });
}
