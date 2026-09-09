import { expect, it, vi } from "vitest";
import { privateCreatorJournal } from "./private-creator-journal";
import { BUYER_NETWORK, BUYER_USDC } from "../buyer/protocol";
import type { ServerX402Attempt } from "./server-x402-client";

const context = { id: `prv_${"a".repeat(64)}`, payer: `0x${"11".repeat(20)}`, workerId: "00000000-0000-4000-8000-000000000001",
  kind: "citation" as const, sourceId: "synthetic-source", itemId: null };
const submission = { authorizationId: `0x${"22".repeat(32)}`, authorizationExpiresAt: "2033-05-18T03:33:20.000Z",
  payer: `0x${"33".repeat(20)}`, payee: `0x${"44".repeat(20)}`, amountMicros: "20000", network: BUYER_NETWORK, asset: BUYER_USDC };
const receipt: ServerX402Attempt<unknown> = { delivered: false, settlementStatus: "settled", transaction: "synthetic-confirmed-reference",
  authorizationId: submission.authorizationId, authorizationExpiresAt: submission.authorizationExpiresAt, amountUsdc: 0.02, httpStatus: 500 };

it("retains settled-but-undelivered evidence if confirmation persistence fails and allows only receipt persistence retry", async () => {
  const db = { admitPrivateCreatorSubmission: vi.fn().mockResolvedValue(true), confirmPrivateCreatorSubmission: vi.fn().mockRejectedValueOnce(new Error("synthetic DB outage"))
    .mockResolvedValueOnce({ confirmation: { source: "circle-facilitator-success", transaction: receipt.transaction, submission }, settledAt: "2026-09-09T00:00:00.000Z" }) };
  const journal = privateCreatorJournal(db, context);
  await journal.beforeSubmit(submission);
  expect(await journal.recordOutcome(receipt)).toEqual({ attempt: receipt, confirmation: null, journalStatus: "confirmation-unpersisted" });
  expect(await journal.recordOutcome(receipt)).toMatchObject({ attempt: receipt, journalStatus: "confirmed" });
  await expect(journal.beforeSubmit(submission)).rejects.toThrow("already used");
  expect(db.admitPrivateCreatorSubmission).toHaveBeenCalledTimes(1);
  expect(db.confirmPrivateCreatorSubmission).toHaveBeenCalledTimes(2);
});

it("never promotes a pending or mismatched observation and never re-arms uncertain admission", async () => {
  const db = { admitPrivateCreatorSubmission: vi.fn().mockResolvedValue(true), confirmPrivateCreatorSubmission: vi.fn() };
  const journal = privateCreatorJournal(db, context);
  expect(await journal.recordOutcome(receipt)).toMatchObject({ attempt: receipt, journalStatus: "receipt-mismatch" });
  await journal.beforeSubmit(submission);
  expect(await journal.recordOutcome({ ...receipt, settlementStatus: "pending", transaction: null })).toMatchObject({ journalStatus: "pending" });
  for (const altered of [{ authorizationId: `0x${"55".repeat(32)}` }, { amountUsdc: 0.03 }, { authorizationExpiresAt: "2040-01-01T00:00:00.000Z" }]) {
    expect(await journal.recordOutcome({ ...receipt, ...altered })).toMatchObject({ journalStatus: "receipt-mismatch" });
  }
  expect(db.confirmPrivateCreatorSubmission).not.toHaveBeenCalled();
  const lost = privateCreatorJournal({ ...db, admitPrivateCreatorSubmission: vi.fn().mockRejectedValue(new Error("ack lost")) }, context);
  await expect(lost.beforeSubmit(submission)).rejects.toThrow("ack lost");
  await expect(lost.beforeSubmit(submission)).rejects.toThrow("already used");
});
