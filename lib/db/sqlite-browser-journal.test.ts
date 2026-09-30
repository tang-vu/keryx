import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SqliteAdapter } from "./sqlite-adapter";
import type { BrowserJournalAdmission } from "./browser-authorization-journal";

const signer = "0x1111111111111111111111111111111111111111",
  payee = "0x2222222222222222222222222222222222222222";
const files: string[] = [],
  adapters: SqliteAdapter[] = [];
const grant = (epoch = "epoch", sessionId = "owner") => ({
  sessionId,
  sessAddr: signer,
  ownerAddr: sessionId,
  cap: 0.000002,
  expiry: Date.now() + 60000,
  txHash: "test",
  grantEpoch: epoch,
});
const input = (
  requestId: string,
  epoch = "epoch",
  sessionId = "owner"
): BrowserJournalAdmission => ({
  sessionId,
  requestId,
  queryId: "query",
  grantEpoch: epoch,
  signer,
  network: "eip155:5042002",
  token: "0x3600000000000000000000000000000000000000",
  gatewayContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  sourceId: "source",
  offerId: null,
  kind: "fetch",
  payee,
  amountMicroUsdc: 1,
  requirements: {
    scheme: "exact",
    network: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000",
    amount: "1",
    payTo: payee,
    maxTimeoutSeconds: 691200,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    },
  },
  payment: {
    kind: "fetch",
    queryId: "query",
    sourceId: "source",
    sourceName: "Source",
    payer: signer,
    payee,
    amountUsdc: 0.000001,
    network: "eip155:5042002",
    grantEpoch: epoch,
  },
});
async function setup(active = true) {
  const file = path.join(
    os.tmpdir(),
    `keryx-journal-${crypto.randomUUID()}.sqlite`
  );
  files.push(file);
  const db = new SqliteAdapter(file);
  adapters.push(db);
  await db.init();
  await db.upsertSessionGrant(grant());
  if (active) await db.activateBrowserJournal();
  return { db, file };
}
afterEach(() => {
  for (const db of adapters.splice(0)) db.close();
  for (const file of files.splice(0))
    for (const suffix of ["", "-wal", "-shm"])
      fs.rmSync(file + suffix, { force: true });
});

it("defaults inactive and refuses mismatched economic tuples before reservation", async () => {
  const { db } = await setup(false);
  expect(await db.admitBrowserJournal(input("r"))).toEqual({
    status: "inactive",
  });
  await expect(
    db.admitBrowserJournal({
      ...input("r"),
      payment: { ...input("r").payment, payee: signer },
    })
  ).rejects.toThrow(/tuple/);
  expect((await db.getSessionGrant("owner"))?.spent).toBe(0);
});
it("atomically bridges the last micro units, persists exposed without expiry, and never cancels exposure", async () => {
  const { db, file } = await setup();
  const second = new SqliteAdapter(file);
  adapters.push(second);
  await second.init();
  const result = await Promise.all([
    db.admitBrowserJournal(input("a")),
    second.admitBrowserJournal(input("b")),
    db.admitBrowserJournal(input("c")),
  ]);
  expect(result.map((r) => r.status)).toEqual([
    "admitted",
    "admitted",
    "grant_or_cap_refused",
  ]);
  expect(await db.exposeBrowserJournal("owner", "a")).toBe(true);
  expect(await db.cancelPreparedBrowserJournal("owner", "a")).toBe(false);
  expect(await db.cancelPreparedBrowserJournal("owner", "b")).toBe(true);
  expect(await db.cancelPreparedBrowserJournal("owner", "b")).toBe(false);
  expect((await second.getBrowserJournal("owner", "a"))?.phase).toBe("exposed");
  expect(await db.listPendingPayments(10)).toHaveLength(1);
  expect((await db.getSessionGrant("owner"))?.spent).toBe(0.000001);
});
it("rolls back bridge insertion failure and writer capability", async () => {
  const { db, file } = await setup();
  const raw = new DatabaseSync(file);
  raw.exec(
    "CREATE TRIGGER force_failure BEFORE INSERT ON payment_events BEGIN SELECT RAISE(ABORT,'fault'); END"
  );
  await expect(db.admitBrowserJournal(input("a"))).rejects.toThrow("fault");
  expect(
    raw.prepare("SELECT count(*) n FROM browser_authorization_intents").get()?.n
  ).toBe(0);
  expect(
    raw.prepare("SELECT count(*) n FROM browser_journal_writer").get()?.n
  ).toBe(0);
  expect((await db.getSessionGrant("owner"))?.spent).toBe(0);
  raw.close();
});
it("fences literal old writers after reopen including reset, release, delete and reserve", async () => {
  const { db, file } = await setup();
  await db.admitBrowserJournal(input("a"));
  const raw = new DatabaseSync(file);
  for (const sql of [
    "UPDATE session_grants SET spent=0",
    "DELETE FROM session_grants",
    "UPDATE session_grants SET spent=spent+0.000001",
    "INSERT OR REPLACE INTO session_grants SELECT * FROM session_grants",
  ])
    expect(() => raw.exec(sql)).toThrow("journal writer required");
  raw.close();
  await expect(
    db.addSessionGrantSpend("owner", "epoch", signer, 0.000001)
  ).rejects.toThrow("journal writer required");
});
it("retains cumulative signer accounting through expiry/revoke/replacement and session aliases", async () => {
  const { db } = await setup();
  await db.admitBrowserJournal(input("a"));
  await db.exposeBrowserJournal("owner", "a");
  await db.deleteSessionGrant("owner");
  expect((await db.getSessionGrant("owner"))?.spent).toBe(0.000001);
  await db.upsertSessionGrant(grant("replacement"));
  await db.upsertSessionGrant(grant("alias", "another"));
  expect((await db.getSessionGrant("another"))?.spent).toBe(0.000001);
  expect(
    (await db.admitBrowserJournal(input("b", "alias", "another"))).status
  ).toBe("admitted");
  expect((await db.admitBrowserJournal(input("c", "replacement"))).status).toBe(
    "grant_or_cap_refused"
  );
});
it("persists exact signed metadata before submission and rejects conflicting replay", async () => {
  const { db } = await setup();
  await db.admitBrowserJournal(input("a"));
  const m = {
    validAfter: "1",
    validBefore: "2000000000",
    headerHash: "a".repeat(64),
  };
  expect(await db.signBrowserJournal("owner", "a", m)).toBe(false);
  await db.exposeBrowserJournal("owner", "a");
  expect(await db.signBrowserJournal("owner", "a", m)).toBe(true);
  expect(await db.signBrowserJournal("owner", "a", m)).toBe(true);
  expect(
    await db.signBrowserJournal("owner", "a", {
      ...m,
      headerHash: "b".repeat(64),
    })
  ).toBe(false);
  expect(await db.submitBrowserJournal("owner", "a")).toBe(true);
  expect(await db.submitBrowserJournal("owner", "a")).toBe(false);
  expect(
    (await db.getBrowserJournal("owner", "a"))?.payment.authorizationExpiresAt
  ).toBe("2033-05-18T03:33:20.000Z");
});

it("does not publish prepared/cancelled nonce through payment feeds or reconciliation", async () => {
  const { db } = await setup();
  const admitted = await db.admitBrowserJournal(input("a"));
  expect(admitted.status).toBe("admitted");
  for (const rows of [
    await db.listPayments(10),
    await db.listPaymentsBySource("source"),
    await db.listCreatorPaymentAttemptsByQuery("query"),
    await db.listPendingPayments(10),
  ])
    expect(rows).toEqual([]);
  await db.exposeBrowserJournal("owner", "a");
  expect((await db.listPayments(10))[0].authorizationPhase).toBe("exposed");
  await db.admitBrowserJournal(input("b"));
  await db.cancelPreparedBrowserJournal("owner", "b");
  expect(await db.listPayments(10)).toHaveLength(1);
});
it("refuses old alternate-ID payment inserts, financial edits and delete after admission", async () => {
  const { db, file } = await setup();
  const result = await db.admitBrowserJournal(input("a"));
  if (result.status !== "admitted") throw new Error("admission failed");
  const raw = new DatabaseSync(file),
    nonce = result.journal.nonce;
  expect(() =>
    raw
      .prepare(
        "INSERT INTO payment_events(id,authorization_id) VALUES('duplicate',?)"
      )
      .run(nonce)
  ).toThrow("already admitted");
  expect(() =>
    raw
      .prepare(
        "UPDATE payment_events SET amount_usdc=1 WHERE authorization_id=?"
      )
      .run(nonce)
  ).toThrow();
  expect(() =>
    raw
      .prepare("DELETE FROM payment_events WHERE authorization_id=?")
      .run(nonce)
  ).toThrow("retained");
  raw.close();
});
it("releases the original retained epoch exactly once after replacement and prevents signed/terminal races", async () => {
  const { db } = await setup();
  const result = await db.admitBrowserJournal(input("a"));
  if (result.status !== "admitted") throw new Error("admission failed");
  await db.exposeBrowserJournal("owner", "a");
  await db.upsertSessionGrant(grant("replacement"));
  expect(
    await db.failPendingPayment(
      result.journal.payment.id!,
      result.journal.nonce,
      "circle-failure"
    )
  ).toEqual({ resolved: true, reservationReleased: true });
  expect(
    await db.failPendingPayment(
      result.journal.payment.id!,
      result.journal.nonce,
      "circle-failure"
    )
  ).toEqual({ resolved: false, reservationReleased: false });
  expect(
    await db.signBrowserJournal("owner", "a", {
      validAfter: "1",
      validBefore: "2000000000",
      headerHash: "a".repeat(64),
    })
  ).toBe(false);
  expect((await db.getSessionGrant("owner"))?.spent).toBe(0);
  expect((await db.getBrowserJournal("owner", "a"))?.phase).toBe("failed");
});
it("imports orphan legacy epochs conservatively without inventing signature/phase and releases proven failure", async () => {
  const { db } = await setup(false);
  await db.recordPayment({
    id: "legacy",
    kind: "fetch",
    queryId: "old",
    sourceId: "source",
    sourceName: "Source",
    payer: signer,
    payee,
    amountUsdc: 0.000001,
    network: "eip155:5042002",
    createdAt: new Date().toISOString(),
    settled: false,
    settlementStatus: "pending",
    authorizationId: "legacy-nonce",
    grantEpoch: "deleted-epoch",
  });
  await db.activateBrowserJournal();
  expect((await db.getSessionGrant("owner"))?.spent).toBe(0.000001);
  expect(
    (await db.listPendingPayments(10))[0].authorizationPhase
  ).toBeUndefined();
  expect(
    await db.failPendingPayment("legacy", "legacy-nonce", "failed")
  ).toEqual({ resolved: true, reservationReleased: true });
  expect((await db.getSessionGrant("owner"))?.spent).toBe(0);
});
it.each([NaN, Infinity, -Infinity, undefined])(
  "refuses nonfinite or missing payment amount before admission",
  async (amount) => {
    const { db } = await setup();
    await expect(
      db.admitBrowserJournal({
        ...input("a"),
        payment: { ...input("a").payment, amountUsdc: amount as number },
      })
    ).rejects.toThrow("tuple");
    expect((await db.getSessionGrant("owner"))?.spent).toBe(0);
  }
);

it("credits only exact confirmed consumption, deduplicating identical nonce and refusing conflicting history", async () => {
  const { db } = await setup(false);
  const nonce = `0x${"ab".repeat(32)}`;
  const payment = {
    id: "confirmed",
    kind: "fetch" as const,
    queryId: "old",
    sourceId: "source",
    sourceName: "Source",
    payer: signer,
    payee,
    amountUsdc: 0.000001,
    network: "eip155:5042002",
    createdAt: new Date().toISOString(),
    settled: true,
    settlementStatus: "settled" as const,
    authorizationId: nonce,
    grantEpoch: "old",
    txHash: "synthetic-circle-proof",
  };
  await db.recordPayment(payment);
  await db.recordPayment({ ...payment, id: "identical-duplicate" });
  await db.recordPayment({
    ...payment,
    id: "unsigned-history",
    authorizationId: undefined,
  });
  await db.recordPayment({
    ...payment,
    id: "no-proof",
    authorizationId: `0x${"cd".repeat(32)}`,
    txHash: "  ",
  });
  expect(await db.browserSignerConfirmedSpendMicro(signer)).toBe(1);
  await db.recordPayment({
    ...payment,
    id: "conflicting-duplicate",
    payee: signer,
  });
  await expect(db.browserSignerConfirmedSpendMicro(signer)).rejects.toThrow(
    "Conflicting"
  );
});
it("refuses fractional settled consumption rather than rounding historical recovery credit", async () => {
  const { db } = await setup(false);
  await db.recordPayment({
    id: "fractional",
    kind: "fetch",
    queryId: "old",
    sourceId: "source",
    sourceName: "Source",
    payer: signer,
    payee,
    amountUsdc: 0.0000001,
    network: "eip155:5042002",
    createdAt: new Date().toISOString(),
    settled: true,
    settlementStatus: "settled",
    authorizationId: `0x${"ab".repeat(32)}`,
    grantEpoch: "old",
    txHash: "synthetic-circle-proof",
  });
  await expect(db.browserSignerConfirmedSpendMicro(signer)).rejects.toThrow(
    "Invalid historical settled amount"
  );
  await expect(db.activateBrowserJournal()).rejects.toThrow();
  expect(await db.browserJournalActive()).toBe(false);
});

it.each([
  "before_commit",
  "prepared",
  "exposed",
  "before_signed_write",
  "signed",
  "submission_attempted",
])(
  "recovers exact ledger and capacity after killing the writer at %s",
  async (boundary) => {
    const { db, file } = await setup();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/fixtures/browser-authorization-crash.mts",
          file,
          boundary,
          JSON.stringify(input("crash")),
        ],
        { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe", "ipc"] }
      );
      let reached = false,
        stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("crash boundary timed out"));
      }, 15000);
      child.on("message", () => {
        reached = true;
        child.kill("SIGKILL");
      });
      child.on("error", reject);
      child.on("close", () => {
        clearTimeout(timer);
        if (reached) resolve();
        else reject(new Error(stderr));
      });
    });
    const reopened = new SqliteAdapter(file);
    adapters.push(reopened);
    await reopened.init();
    const journal = await reopened.getBrowserJournal("owner", "crash");
    if (boundary === "before_commit") {
      expect(journal).toBeNull();
      expect((await db.getSessionGrant("owner"))?.spent).toBe(0);
    } else {
      expect(journal?.phase).toBe(
        boundary === "before_signed_write" ? "exposed" : boundary
      );
      expect((await reopened.getSessionGrant("owner"))?.spent).toBe(0.000001);
      if (boundary === "prepared")
        expect(
          await reopened.cancelPreparedBrowserJournal("owner", "crash")
        ).toBe(true);
      else
        expect(
          await reopened.cancelPreparedBrowserJournal("owner", "crash")
        ).toBe(false);
    }
    const raw = new DatabaseSync(file);
    expect(
      raw.prepare("SELECT count(*) n FROM browser_journal_writer").get()?.n
    ).toBe(0);
    raw.close();
  },
  20000
);
