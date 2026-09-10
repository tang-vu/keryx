import type { createPrivateWorker } from "./private-worker";
import type { createPrivateResultRecovery } from "./private-result-recovery";
import type { PrivateWorkerPhase } from "./private-worker-status";
import type { createPrivateReconciliation } from "./private-reconciliation";

type Worker = ReturnType<typeof createPrivateWorker>;
type Recovery = ReturnType<typeof createPrivateResultRecovery>;
type Reconciliation = ReturnType<typeof createPrivateReconciliation>;
type Summary = Awaited<ReturnType<Worker["tick"]>> | Awaited<ReturnType<Recovery["tick"]>> |
  Awaited<ReturnType<Reconciliation["tick"]>> | { status: "tick-unavailable" | "stopped" };

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
  signal: AbortSignal; once?: boolean; pollMs?: number; recovery?: Recovery;
  reconciliation?: Reconciliation;
  observe?: (phase: PrivateWorkerPhase) => Promise<void>; report: (summary: Summary) => void;
}) {
  const { signal, once, report } = options;
  const pollMs = options.pollMs ?? 5000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 1000 || pollMs > 60000) throw new Error("Invalid private worker poll interval");
  try {
    if (options.observe) await options.observe("starting");
    while (!signal.aborted) {
    let summary: Summary;
    try {
      if (options.recovery) {
        if (options.observe) await options.observe("recovering");
        const recovered = await options.recovery.tick(signal);
        report(recovered);
        if (!recovered.ready || signal.aborted) {
          if (options.observe) await options.observe(recovered.errors ? "degraded" : "recovering");
          if (once || signal.aborted) break;
          await pause(pollMs, signal);
          continue;
        }
      }
      if (options.observe) await options.observe("working");
      let reconciliationHealthy = true;
      if (options.reconciliation) {
        const reconciled = await options.reconciliation.tick(signal);
        report(reconciled);
        reconciliationHealthy = reconciled.errors === 0 && reconciled.mismatched === 0 && reconciled.failedObserved === 0;
        if (signal.aborted) break;
      }
      summary = await worker.tick(signal);
      const healthy = reconciliationHealthy && summary.status === "processed" && summary.errors === 0 && summary.unpersisted === 0;
      if (options.observe) await options.observe(healthy ? "idle" : "degraded");
    }
    catch {
      summary = { status: "tick-unavailable" };
      try { if (options.observe) await options.observe("degraded"); } catch { /* Status storage is unavailable. */ }
    }
    report(summary);
    if (once || signal.aborted) break;
    await pause(pollMs, signal);
  } } finally {
    try { await options.recovery?.close(); }
    finally { await options.observe?.("stopped"); }
  }
  report({ status: "stopped" });
}
