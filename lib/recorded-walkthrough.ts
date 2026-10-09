import { verifyBrowserReceipt } from "./browser-receipt-integrity";
import { readBoundedJson } from "./read-bounded-json";

/** Public owner-operated QA, already published in docs/reviewer-start.md.
 * These fixed identifiers confer no payment or private-job authority. */
export const recordedWalkthrough = Object.freeze({
  reportPath: "/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913",
  receiptPath: "/api/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913/receipt",
  circleTransferId: "f2751e74-754b-48a7-b416-6e682410ac9f",
  digest: "sha256:97803e69c805d4c5ce4fa1470ed2336571799697f0a7ec90d59e33d4674553b6",
  snapshotUrl: "https://github.com/tang-vu/keryx/blob/main/fixtures/walkthrough/recorded-mainnet-receipt.json",
  scopeUrl: "https://github.com/tang-vu/keryx/blob/main/docs/reviewer-start.md",
  videoUrl: "https://github.com/tang-vu/keryx/releases/download/v0.27.43/keryx-current-release-6e591603-archived-qa-05.mp4",
} as const);

export async function checkRecordedReceipt(value: unknown): Promise<"matched" | "changed"> {
  const result = await verifyBrowserReceipt(value);
  return result.valid && result.actualDigest === recordedWalkthrough.digest ? "matched" : "changed";
}

/** One caller-initiated public GET only; never a live research/settlement check. */
export async function readRecordedReceipt(signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const response = await fetcher(recordedWalkthrough.receiptPath, {
    method: "GET", headers: { Accept: "application/json" }, credentials: "omit",
    cache: "no-store", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Recorded receipt unavailable"); }
  return checkRecordedReceipt(await readBoundedJson(response, 262_144));
}
