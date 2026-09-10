import type { KeryxDB } from "../db/keryx-db";
import type { privateResearchService } from "./private-research-service";

type Service = NonNullable<ReturnType<typeof privateResearchService>>;
export type PrivatePurchaseBootstrap = (db: KeryxDB, signal: AbortSignal, authenticatedPayer?: string) => Service | null | Promise<Service | null>;

/** Bound server-owned READ-ONLY readiness checks. The bootstrap must not sign,
 * reserve, settle or start work. Late completion cannot resume a refused purchase. */
export async function readyPrivatePurchaseService(bootstrap: PrivatePurchaseBootstrap, db: KeryxDB, requestSignal: AbortSignal, authenticatedPayer?: string) {
  if (requestSignal.aborted) return null;
  const stop = new AbortController();
  let cancel!: () => void;
  const unavailable = new Promise<null>(resolve => { cancel = () => { stop.abort(); resolve(null); }; });
  const timer = setTimeout(cancel, 5000);
  requestSignal.addEventListener("abort", cancel, { once: true });
  try {
    if (requestSignal.aborted) { cancel(); return null; }
    return await Promise.race([
      Promise.resolve().then(() => stop.signal.aborted ? null : bootstrap(db, stop.signal, authenticatedPayer)).catch(() => null),
      unavailable,
    ]);
  } finally {
    clearTimeout(timer); requestSignal.removeEventListener("abort", cancel);
    stop.abort();
  }
}
