import { basename, dirname, resolve } from "node:path";
import { access, stat } from "node:fs/promises";
import { readPrivateBuyerJournal } from "./private-journal";
import { withPrivateBuyerSession } from "./private-account-session";
import { recoverPrivateBuyerResult } from "./private-recovery";
import { writeBuyerFile } from "./journal";
import { BUYER_NETWORK } from "./protocol";
import { buyerFetch, type BuyerFetch } from "./transport";
import type { PrivateMerchantPolicy } from "./private-merchant-policy";

/** No payment operation is reachable. Snapshot output is explicit, plaintext and exclusive. */
export async function recoverPrivateBuyerWorkflow(directory: string, merchants: PrivateMerchantPolicy,
  account: Parameters<typeof withPrivateBuyerSession>[0], options: { output?: string; http?: BuyerFetch } = {}) {
  const output = options.output === undefined ? undefined : resolve(options.output);
  const http = options.http ?? buyerFetch;
  // Reject a corrupt/foreign journal before prompting for a login signature or doing HTTP.
  await readPrivateBuyerJournal(directory, account.address, merchants);
  if (output) {
    if (!(await stat(dirname(output))).isDirectory()) throw new Error("Private snapshot parent unavailable");
    try { await access(output); throw new Error("Private snapshot destination already exists"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const view = await withPrivateBuyerSession(account,
    cookie => recoverPrivateBuyerResult(directory, account.address, merchants, cookie, http), http);
  if (output) await writeBuyerFile(dirname(output), basename(output), { schema: "keryx-private-result-snapshot-v1",
    evidence: "server-reported", recordedAt: new Date().toISOString(), view });
  return { network: BUYER_NETWORK, status: view.status, incomingStatus: view.spend.incoming.status,
    priceMicros: view.spend.incoming.priceMicros, creatorBudgetMicros: view.spend.creator.budgetMicros,
    committedMicros: view.spend.creator.committedMicros, confirmedMicros: view.spend.creator.confirmedMicros,
    uncommittedMicros: view.spend.creator.uncommittedMicros, evidence: "server-reported",
    snapshotWritten: Boolean(output), signOutConfirmed: true, paymentRequestsSent: 0 };
}
