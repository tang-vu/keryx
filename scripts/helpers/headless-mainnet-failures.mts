import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../lib/canonical-json";
import { readBrowserSessionPaymentAccounting, type BrowserSessionFailedAuthorization } from "../../lib/session/browser-session-withdrawal-liabilities";
import type { BrowserSessionAuthorizationBinding } from "../../lib/session/browser-session-runtime";
import type { openHeadlessMainnetState } from "./headless-mainnet-state.mjs";

export const HEADLESS_FAILURE_SCHEMA = `
CREATE TABLE failed_terminal(nonce TEXT PRIMARY KEY REFERENCES exposure(nonce),evidence TEXT NOT NULL CHECK(json_valid(evidence))) STRICT;
CREATE TRIGGER failed_terminal_no_update BEFORE UPDATE ON failed_terminal BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER failed_terminal_no_delete BEFORE DELETE ON failed_terminal BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER failed_terminal_no_settled BEFORE INSERT ON failed_terminal WHEN EXISTS(SELECT 1 FROM terminal WHERE nonce=new.nonce)
BEGIN SELECT RAISE(ABORT,'conflicting terminal evidence'); END;
CREATE TRIGGER settled_terminal_no_failed BEFORE INSERT ON terminal WHEN EXISTS(SELECT 1 FROM failed_terminal WHERE nonce=new.nonce)
BEGIN SELECT RAISE(ABORT,'conflicting terminal evidence'); END;
`;

/** Only the shared original-bound verifier supplies this witness. The native CAS
 * rechecks the complete retained tuple and never edits the original or its header. */
export function recordHeadlessFailure(db: DatabaseSync, value: BrowserSessionFailedAuthorization): boolean {
  const row = db.prepare("SELECT nonce,epoch,amount,original,requirements_digest FROM exposure WHERE nonce=?").get(value.nonce);
  if (!row || value.epoch !== row.epoch || value.amount !== row.amount || value.requirementsDigest !== row.requirements_digest ||
    canonicalJson(value.original) !== row.original || !/^[0-9a-f]{64}$/.test(value.evidenceDigest) ||
    !value.transferId.trim() || value.transferId.length > 256)
    throw new Error("Original headless failure evidence refused");
  const evidence = canonicalJson(value), prior = db.prepare("SELECT evidence FROM failed_terminal WHERE nonce=?").get(value.nonce);
  if (prior) {
    if (prior.evidence !== evidence) throw new Error("Original headless failure evidence differs");
    return false;
  }
  db.prepare("INSERT INTO failed_terminal VALUES(?,?)").run(value.nonce, evidence);
  return true;
}

/** Inspect every retained epoch: a renewed grant cannot hide an older failed hold. */
export async function reconcileHeadlessFailures(state: Awaited<ReturnType<typeof openHeadlessMainnetState>>,
  owner: string, signer: string, json: (path: string) => Promise<unknown>): Promise<number> {
  const groups = new Map<string, Array<{ nonce: string; epoch: string; amount: string;
    original: BrowserSessionAuthorizationBinding; requirementsDigest: string }>>();
  for (const row of state.unresolvedNonces()) {
    const original = JSON.parse(String(row.original)) as BrowserSessionAuthorizationBinding;
    if (original.sessionId !== owner || original.sessAddr !== signer.toLowerCase())
      throw new Error("Original headless failure owner differs");
    const epoch = String(row.epoch), rows = groups.get(epoch) ?? [];
    rows.push({ nonce: String(row.nonce), epoch, amount: String(row.amount), original, requirementsDigest: String(row.requirements_digest) });
    groups.set(epoch, rows);
  }
  let released = 0;
  for (const [epoch, rows] of groups) {
    const accounting = await readBrowserSessionPaymentAccounting(rows, owner, signer.toLowerCase(), epoch, json);
    for (const failure of accounting.failures) if (state.recordFailed(failure)) released++;
  }
  return released;
}
