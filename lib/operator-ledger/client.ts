import { canonicalJson } from "../canonical-json";
import { readBoundedJson } from "../read-bounded-json";
import { validateLedgerBindings } from "./validate";
import type { OperatorLedger } from "./contracts";

export async function verifyBrowserOperatorLedger(value: unknown, retainedDigest?: string): Promise<OperatorLedger> {
  // Closed binding validation copies the caller object before the WebCrypto await.
  const ledger = validateLedgerBindings(value);
  const bytes = new TextEncoder().encode(canonicalJson(ledger.payload));
  const result = await crypto.subtle.digest("SHA-256", bytes);
  const digest = `sha256:${Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, "0")).join("")}`;
  if (ledger.integrity.digest !== digest || retainedDigest !== undefined && digest !== retainedDigest) throw new Error("Ledger digest mismatch");
  return ledger;
}

export async function fetchOperatorLedger(origin: string, days = 7, signal?: AbortSignal) {
  const base = new URL(origin);
  if (base.username || base.password || base.origin !== origin || base.protocol !== "https:" &&
    !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) ||
    !Number.isSafeInteger(days) || days < 1 || days > 31) throw new Error("Ledger observation origin/window refused");
  const response = await fetch(`${origin}/api/operator/ledger?days=${days}`, { cache: "no-store", redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Public transfer ledger unavailable");
  const ledger = await verifyBrowserOperatorLedger(await readBoundedJson(response, 2_000_000));
  if (response.headers.get("X-Keryx-Ledger-Digest") !== ledger.integrity.digest || ledger.payload.window.days !== days)
    throw new Error("Ledger response binding mismatch");
  return ledger;
}
