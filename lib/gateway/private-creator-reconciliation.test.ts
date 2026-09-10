import { expect, it, vi } from "vitest";
import { reconcilePrivateCreatorSubmissions } from "./private-creator-reconciliation";
import type { PrivateCreatorSubmissionRecord } from "../db/private-creator-submissions";
import { BUYER_NETWORK, BUYER_USDC } from "../buyer/protocol";
import type { CircleX402Transfer } from "./x402-transfer-reconciliation";

const row: PrivateCreatorSubmissionRecord = { jobId: `prv_${"a".repeat(64)}`, legId: "b".repeat(64), workerId: "worker",
  startedAt: "2026-09-09T00:00:00.000Z", data: { kind: "citation", sourceId: "private-source-marker", itemId: null,
    submission: { authorizationId: `0x${"c".repeat(64)}`, authorizationExpiresAt: "2026-09-01T00:00:00.000Z",
      payer: `0x${"11".repeat(20)}`, payee: `0x${"22".repeat(20)}`, amountMicros: "20000", network: BUYER_NETWORK, asset: BUYER_USDC } } };
const transfer: CircleX402Transfer = { id: "synthetic-transfer-id", status: "completed", token: "USDC", sendingNetwork: BUYER_NETWORK,
  recipientNetwork: BUYER_NETWORK, fromAddress: row.data.submission.payer, toAddress: row.data.submission.payee,
  amount: "20000", nonce: row.data.submission.authorizationId, txHash: null, createdAt: row.startedAt, updatedAt: row.startedAt };
function storage() { return { listPrivateCreatorSubmissions: vi.fn().mockResolvedValue([row]),
  getPrivateCreatorConfirmation: vi.fn().mockResolvedValue(null), confirmPrivateCreatorSubmission: vi.fn().mockResolvedValue({}) }; }

it("retains the exact accepted Circle stage and strips private job/source context from search input", async () => {
  for (const status of ["received", "batched", "confirmed", "completed"] as const) {
    const db = storage(), search = vi.fn().mockResolvedValue([{ ...transfer, status }]);
    const processing = status === "received" || status === "batched";
    expect(await reconcilePrivateCreatorSubmissions(db, row.jobId, "owner", { search })).toMatchObject({
      confirmed: processing ? 0 : 1, processing: processing ? 1 : 0, unavailable: 0, remaining: 0 });
    expect(db.confirmPrivateCreatorSubmission).toHaveBeenCalledWith(row.jobId, "owner", row.workerId, {
      source: "circle-transfer-search", transaction: transfer.id, transferStatus: status, submission: row.data.submission });
    expect(JSON.stringify(search.mock.calls[0][0])).not.toContain(row.jobId);
    expect(JSON.stringify(search.mock.calls[0][0])).not.toContain(row.data.sourceId);
  }
});

it("never promotes absence, terminal failure, mismatched tuples, duplicates or unknown stages, even after expiry", async () => {
  const cases = [ { rows: [], counter: "awaiting" }, { rows: [{ ...transfer, status: "failed" }], counter: "failedObserved" },
    { rows: [{ ...transfer, amount: "20001" }], counter: "mismatched" }, { rows: [transfer, transfer], counter: "mismatched" },
    { rows: [{ ...transfer, status: "unexpected" }], counter: "mismatched" }, { rows: [{ ...transfer, toAddress: transfer.fromAddress }], counter: "mismatched" } ];
  for (const item of cases) {
    const db = storage();
    expect(await reconcilePrivateCreatorSubmissions(db, row.jobId, "owner", { search: vi.fn().mockResolvedValue(item.rows) })).toMatchObject({ [item.counter]: 1, confirmed: 0 });
    expect(db.confirmPrivateCreatorSubmission).not.toHaveBeenCalled();
  }
});

it("keeps storage/search failures unresolved and permits bounded continuation beyond a pending prefix", async () => {
  const db = storage();
  db.listPrivateCreatorSubmissions.mockResolvedValue([row, { ...row, legId: "d".repeat(64) }]);
  const search = vi.fn().mockResolvedValue([]);
  const first = await reconcilePrivateCreatorSubmissions(db, row.jobId, "owner", { search, limit: 1 });
  expect(first).toMatchObject({ awaiting: 1, remaining: 1, nextCursor: row.legId });
  expect(await reconcilePrivateCreatorSubmissions(db, row.jobId, "owner", { search, limit: 1, cursor: first.nextCursor! })).toMatchObject({ awaiting: 1, remaining: 0, nextCursor: null });
  await expect(reconcilePrivateCreatorSubmissions(db, row.jobId, "owner", { cursor: "f".repeat(64) })).rejects.toThrow("cursor unavailable");
  for (const where of ["search", "storage"] as const) {
    const failing = storage();
    if (where === "storage") failing.confirmPrivateCreatorSubmission.mockRejectedValue(new Error("synthetic outage"));
    const lookup = where === "search" ? vi.fn().mockRejectedValue(new Error("synthetic outage")) : vi.fn().mockResolvedValue([transfer]);
    expect(await reconcilePrivateCreatorSubmissions(failing, row.jobId, "owner", { search: lookup })).toMatchObject({ confirmed: 0, unavailable: 1 });
  }
  const already = storage(); already.getPrivateCreatorConfirmation.mockResolvedValue({ confirmation: {
    source: "circle-facilitator-success", transaction: transfer.id, submission: row.data.submission } });
  const skipped = vi.fn();
  expect(await reconcilePrivateCreatorSubmissions(already, row.jobId, "owner", { search: skipped })).toMatchObject({ alreadyConfirmed: 1 });
  expect(skipped).not.toHaveBeenCalled();
});

it("returns the continuation position on abort without visiting another leg", async () => {
  const db = storage(), controller = new AbortController();
  db.listPrivateCreatorSubmissions.mockResolvedValue([row, { ...row, legId: "d".repeat(64) }]);
  const search = vi.fn(async () => { controller.abort(); return []; });
  expect(await reconcilePrivateCreatorSubmissions(db, row.jobId, "owner", { search, signal: controller.signal })).toMatchObject({
    scanned: 1, awaiting: 1, remaining: 1, nextCursor: row.legId });
  expect(search).toHaveBeenCalledTimes(1);
});

it("continues processing observations but refuses to replace their transfer identity", async () => {
  const db = storage();
  db.getPrivateCreatorConfirmation.mockResolvedValue({ confirmation: { source: "circle-transfer-search",
    transferStatus: "batched", transaction: transfer.id, submission: row.data.submission } });
  expect(await reconcilePrivateCreatorSubmissions(db, row.jobId, "owner", {
    search: vi.fn().mockResolvedValue([{ ...transfer, status: "received" }]),
  })).toMatchObject({ processing: 1, confirmed: 0, alreadyConfirmed: 0 });
  expect(db.confirmPrivateCreatorSubmission).not.toHaveBeenCalled();
  expect(await reconcilePrivateCreatorSubmissions(db, row.jobId, "owner", {
    search: vi.fn().mockResolvedValue([{ ...transfer, id: "synthetic-replacement" }]),
  })).toMatchObject({ mismatched: 1, confirmed: 0 });
  expect(db.confirmPrivateCreatorSubmission).not.toHaveBeenCalled();
});
