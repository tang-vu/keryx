import { withdrawalIdSchema } from "./withdrawal-request";
import type { queueWithdrawalRelayPage } from "./withdrawal-relay-queue";
import type { reportWithdrawalCashOutPage } from "./withdrawal-cash-out-page";
import type { runWithdrawalRelayWorker } from "./withdrawal-relay-worker";

type Page = Awaited<ReturnType<typeof queueWithdrawalRelayPage>> | Awaited<ReturnType<typeof reportWithdrawalCashOutPage>>;
type PageReader = (afterId: string | undefined, signal: AbortSignal) => Promise<Page>;
type Relay = (signal: AbortSignal) => ReturnType<typeof runWithdrawalRelayWorker>;

async function sweep(read: PageReader, signal: AbortSignal) {
  let pages = 0, scanned = 0, unavailable = 0, pending = 0, cursor: string | undefined;
  const result = (state: "scanned" | "limited" | "unavailable" | "aborted") =>
    ({ state, pages, scanned, unavailable, pending, nextCursor: cursor ?? null });
  // Runtime binds 32-row pages. 32 pages cover the journal's 1000-request lifetime
  // ceiling, while a malformed cursor cannot cause an unbounded operator loop.
  for (; pages < 32;) {
    if (signal.aborted) return result("aborted");
    try {
      const page = await read(cursor, signal);
      if (signal.aborted || page.state === "aborted") return result("aborted");
      const waiting = "awaitingEvidence" in page ? page.awaitingEvidence : page.notObserved;
      if (![page.scanned, page.unavailable, waiting].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 32)
        || page.unavailable + waiting > page.scanned) throw new Error();
      const next = page.nextCursor === null ? undefined : withdrawalIdSchema.parse(page.nextCursor);
      if (next && (page.scanned === 0 || next <= (cursor ?? ""))) throw new Error();
      if ((page.state === "limited") !== (next !== undefined)) throw new Error();
      pages++; scanned += page.scanned; unavailable += page.unavailable; pending += waiting; cursor = next;
      if (!next) return result("scanned");
    } catch { return result(signal.aborted ? "aborted" : "unavailable"); }
  }
  return result("limited");
}

/** One operator pass, never an automatic Circle transfer retry. Existing verified
 * mint work/reporting can continue after a queue outage. Queue and relay retain
 * their phase locks until awaited work settles, including cancellation; reporting
 * uses immutable observations and the idempotent application ledger.
 * A later invocation starts fresh bounded sweeps to revisit missing evidence. */
export async function runWithdrawalCyclePass(operations: { queue: PageReader; relay: Relay; report: PageReader }, signal: AbortSignal) {
  const { queue, relay, report } = operations;
  const queued = await sweep(queue, signal);
  if (signal.aborted || queued.state === "aborted") return { state: "aborted" as const, queue: queued, relay: null, report: null };
  let relayed: Awaited<ReturnType<Relay>> | null = null;
  try { relayed = await relay(signal); } catch { /* Retained originals remain authoritative. */ }
  if (signal.aborted || relayed?.state === "aborted") return { state: "aborted" as const, queue: queued, relay: relayed, report: null };
  const reported = await sweep(report, signal);
  return { state: signal.aborted || reported.state === "aborted" ? "aborted" as const : "finished" as const,
    queue: queued, relay: relayed, report: reported };
}
