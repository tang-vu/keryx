import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { SESSION_GRANT_CONSENTS_SQL } from "./session-grant-consents";
import { prepareBrowserJournal, type BrowserJournalAdmission } from "./browser-authorization-journal";
import { activateSqliteBrowserJournal, admitSqliteBrowserJournalInTransaction,
  sqliteJournalTransaction, terminalSqliteJournalPayment, transitionSqliteBrowserJournal,
  upsertSqliteJournalGrant } from "./sqlite-browser-journal";
import { sqliteSessionFundingAccounting } from "./session-funding-accounting";

const signer = `0x${"22".repeat(20)}`, owner = `0x${"11".repeat(20)}`, payee = `0x${"33".repeat(20)}`;
const baseline = "2026-10-04T10:00:00.000Z", before = Date.parse(baseline) - 1_000;
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers(); });

function fixture(count: number) {
  vi.useFakeTimers(); vi.setSystemTime(before);
  const db = new DatabaseSync(":memory:"); databases.push(db);
  installSqliteApplicationSchema(db); db.exec(SESSION_GRANT_CONSENTS_SQL);
  activateSqliteBrowserJournal(db, profile);
  upsertSqliteJournalGrant(db, { sessionId: owner, sessAddr: signer, ownerAddr: owner,
    cap: 1, expiry: before + 60_000, txHash: "synthetic-test-grant", grantEpoch: "original-epoch" });
  const nonces: string[] = [];
  sqliteJournalTransaction(db, () => {
    for (let i = 0; i < count; i++) {
      if (i === 10_000) vi.setSystemTime(Date.parse(baseline) + 1_000);
      const input: BrowserJournalAdmission = {
        sessionId: owner, signer, grantEpoch: "original-epoch", requestId: `request-${i}`, queryId: `query-${i}`,
        sourceId: "synthetic-source", offerId: null, kind: "fetch", payee, amountMicroUsdc: 1,
        network: profile.networkId, token: profile.usdcAddress, gatewayContract: profile.gatewayWallet,
        requirements: { scheme: "exact", network: profile.networkId, asset: profile.usdcAddress,
          payTo: payee, amount: "1", maxTimeoutSeconds: 691200,
          extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: profile.gatewayWallet } },
        payment: { kind: "fetch", queryId: `query-${i}`, sourceId: "synthetic-source", sourceName: "Synthetic source",
          payer: signer, payee, amountUsdc: 0.000001, network: profile.networkId, grantEpoch: "original-epoch" },
      };
      const result = admitSqliteBrowserJournalInTransaction(db, input, prepareBrowserJournal(input, profile));
      if (result.status !== "admitted") throw new Error(`Fixture admission failed at ${i}`);
      nonces.push(result.journal.nonce);
    }
  });
  function confirm(index: number) {
    expect(transitionSqliteBrowserJournal(db, owner, `request-${index}`, "prepared", "exposed")).toBe(true);
    expect(terminalSqliteJournalPayment(db, `x402:${nonces[index]}`, nonces[index], `synthetic-confirmation-${index}`, false))
      .toEqual({ resolved: true, reservationReleased: false });
  }
  return { db, nonces, confirm };
}

it("accounts for more than 10,000 valid original mainnet intents without losing retained or baseline debits", () => {
  const { db, confirm } = fixture(10_003);
  confirm(0); confirm(10_001);
  const totalChanges = db.prepare("SELECT total_changes() AS n").get()!.n;
  expect(sqliteSessionFundingAccounting(db, signer, baseline)).toEqual({ hasAuthorityHistory: true,
    confirmedSpentMicroUsdc: "2", retainedSpentMicroUsdc: "10003", postBaselineConfirmedDebitMicroUsdc: "1" });
  expect(sqliteSessionFundingAccounting(db, signer)).toMatchObject({ confirmedSpentMicroUsdc: "2",
    retainedSpentMicroUsdc: "10003", postBaselineConfirmedDebitMicroUsdc: "0" });
  expect(db.prepare("SELECT count(*) AS n FROM browser_authorization_intents").get()!.n).toBe(10_003);
  expect(db.prepare("SELECT total_changes() AS n").get()!.n).toBe(totalChanges);
});

it("fails closed on corrupt original evidence beyond the former lifetime row limit", () => {
  const { db, nonces } = fixture(10_003);
  // Corrupt only this in-memory fixture after genuine original admissions.
  db.prepare("DELETE FROM browser_journal_bindings WHERE nonce=?").run(nonces[10_002]);
  expect(() => sqliteSessionFundingAccounting(db, signer, baseline)).toThrow("Original funding debit evidence unavailable");
  expect(db.prepare("SELECT count(*) AS n FROM browser_authorization_intents").get()!.n).toBe(10_003);
  // A refused streaming read must finalize its cursor and leave the connection usable.
  expect(db.isTransaction).toBe(false);
  expect(db.prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?").get(signer)!.spent_micro).toBe(10_003);
});

it("rejects an unsafe aggregate even when each original micro amount is individually safe", () => {
  const { db, confirm } = fixture(2);
  confirm(0); confirm(1);
  // Deliberately corrupt the disposable fixture; no production guard is relaxed.
  db.exec("DROP TRIGGER browser_intents_immutable_update; DROP TRIGGER browser_payment_tuple_immutable");
  sqliteJournalTransaction(db, () => {
    db.exec(`UPDATE browser_authorization_intents SET amount_micro_usdc=5000000000000000;
      UPDATE payment_events SET amount_usdc=5000000000;
      UPDATE browser_journal_bindings SET requirements=json_set(requirements,'$.amount','5000000000000000'),
        payment_metadata=json_set(payment_metadata,'$.amountUsdc',5000000000);
      UPDATE browser_signer_capacity SET spent_micro=9000000000000000`);
  });
  expect(Number.isSafeInteger(5_000_000_000_000_000)).toBe(true);
  expect(() => sqliteSessionFundingAccounting(db, signer)).toThrow("Session funding accounting unavailable");
  expect(db.isTransaction).toBe(false);
});

it("requires an exact canonical payment id even when its suffix matches an original nonce", () => {
  const { db, nonces } = fixture(1);
  db.prepare("INSERT INTO payment_events(id,payer,grant_epoch) VALUES(?,?,?)")
    .run(`evil:${nonces[0]}`, signer, "original-epoch");
  expect(() => sqliteSessionFundingAccounting(db, signer)).toThrow("Original funding debit evidence unavailable");
});
