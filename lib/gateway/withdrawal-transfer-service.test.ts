import { afterAll, beforeAll, afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { submitWithdrawalTransfer, withdrawalTransferProgress, requestCircleWithdrawalTransfer } from "./withdrawal-transfer-service";

const directory = mkdtempSync(join(tmpdir(), "keryx-transfer-service-")), path = join(directory, "app.sqlite");
let db: SqliteAdapter, other: SqliteAdapter;
beforeAll(async () => { db = new SqliteAdapter(path); other = new SqliteAdapter(path); await db.init(); await other.init(); }, 60000);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(() => { db.close(); other.close(); rmSync(directory, { recursive: true, force: true }); });

it("allows one vendor call across competing callers and recovers the stored attestation", async () => {
  const f = await creatorWithdrawalFixture(), admission = vi.fn(async () => {}), transfer = vi.fn(async () => f.response);
  await Promise.all([db, other].map(store => submitWithdrawalTransfer(store, f.record, f.record.owner, admission, transfer, new AbortController().signal)));
  expect(transfer).toHaveBeenCalledTimes(1);
  expect(await withdrawalTransferProgress(other, f.record.id, f.record.owner)).toMatchObject({ status: "attestation-stored", chainFinalityVerified: false });
  admission.mockClear();
  expect(await submitWithdrawalTransfer(db, f.record, f.record.owner, admission, transfer, new AbortController().signal)).toMatchObject({ status: "attestation-stored" });
  expect(admission).not.toHaveBeenCalled(); expect(transfer).toHaveBeenCalledTimes(1);
});

it("retains an unknown original after response loss and never calls admission or Circle again", async () => {
  const f = await creatorWithdrawalFixture(), admission = vi.fn(async () => {});
  const transfer = vi.fn(async () => { throw new Error("Synthetic lost response"); });
  expect(await submitWithdrawalTransfer(db, f.record, f.record.owner, admission, transfer, new AbortController().signal)).toMatchObject({ status: "awaiting-transfer-evidence" });
  admission.mockClear();
  await submitWithdrawalTransfer(other, f.record, f.record.owner, admission, transfer, new AbortController().signal);
  expect(admission).not.toHaveBeenCalled(); expect(transfer).toHaveBeenCalledTimes(1);
});

it("does not claim or send before durable gas admission succeeds", async () => {
  const f = await creatorWithdrawalFixture(), transfer = vi.fn(async () => f.response);
  await expect(submitWithdrawalTransfer(db, f.record, f.record.owner, async () => { throw new Error("Synthetic admission unavailable"); }, transfer,
    new AbortController().signal)).rejects.toThrow("admission unavailable");
  expect(await db.getCreatorWithdrawalTransferClaim(f.record.id, f.record.owner)).toBeNull();
  expect(transfer).not.toHaveBeenCalled();
  expect(await withdrawalTransferProgress(db, f.record.id, f.record.owner)).toMatchObject({ status: "request-stored" });
});

it("denies foreign owners and avoids consuming a claim for cancellation during admission", async () => {
  const f = await creatorWithdrawalFixture(), transfer = vi.fn(async () => f.response), stop = new AbortController();
  await expect(submitWithdrawalTransfer(db, f.record, `0x${"00".repeat(20)}`, async () => {}, transfer, stop.signal)).rejects.toThrow("owner unavailable");
  expect(await db.getCreatorWithdrawal(f.record.id, f.record.owner)).toBeNull();
  await submitWithdrawalTransfer(db, f.record, f.record.owner, async () => { stop.abort(); }, transfer, stop.signal);
  expect(await db.getCreatorWithdrawalTransferClaim(f.record.id, f.record.owner)).toBeNull(); expect(transfer).not.toHaveBeenCalled();
});

it("recovers a committed response after storage readback fails without repeating the vendor call", async () => {
  const f = await creatorWithdrawalFixture(), save = db.saveCreatorWithdrawalAttestation.bind(db);
  vi.spyOn(db, "saveCreatorWithdrawalAttestation").mockImplementationOnce(async (...args) => {
    await save(...args); throw new Error("Synthetic committed readback lost");
  });
  const transfer = vi.fn(async () => f.response);
  expect(await submitWithdrawalTransfer(db, f.record, f.record.owner, async () => {}, transfer, new AbortController().signal)).toMatchObject({ status: "attestation-stored" });
  expect(transfer).toHaveBeenCalledTimes(1);
});

it("does not renew a committed claim whose response was lost before the vendor call", async () => {
  const f = await creatorWithdrawalFixture(), claim = db.claimCreatorWithdrawalTransfer.bind(db);
  vi.spyOn(db, "claimCreatorWithdrawalTransfer").mockImplementationOnce(async (...args) => {
    await claim(...args); throw new Error("Synthetic claim response lost");
  });
  const admission = vi.fn(async () => {}), transfer = vi.fn(async () => f.response);
  await expect(submitWithdrawalTransfer(db, f.record, f.record.owner, admission, transfer, new AbortController().signal)).rejects.toThrow("claim response lost");
  admission.mockClear();
  expect(await submitWithdrawalTransfer(other, f.record, f.record.owner, admission, transfer, new AbortController().signal)).toMatchObject({ status: "awaiting-transfer-evidence" });
  expect(admission).not.toHaveBeenCalled(); expect(transfer).not.toHaveBeenCalled();
});

it("keeps malformed vendor evidence unresolved and isolates admission callback mutations", async () => {
  const f = await creatorWithdrawalFixture();
  const transfer = vi.fn(async record => {
    expect(record.request).toEqual(f.record.request); return { ...f.response, attestation: "0x00" };
  });
  expect(await submitWithdrawalTransfer(db, f.record, f.record.owner, async record => {
    record.request.burnIntent.spec.value = "1";
  }, transfer, new AbortController().signal)).toMatchObject({ status: "awaiting-transfer-evidence" });
  expect(await db.getCreatorWithdrawalAttestation(f.record.id, f.record.owner)).toBeNull();
});

it("uses the canonical signed request array and does not follow redirects or retry HTTP errors", async () => {
  const f = await creatorWithdrawalFixture();
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual([f.record.request]);
    return Response.json({ error: "Synthetic vendor rejection" }, { status: 503 });
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(requestCircleWithdrawalTransfer(f.record, new AbortController().signal)).rejects.toThrow("response unavailable");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("aborts an unfinished vendor response body at the deadline", async () => {
  const f = await creatorWithdrawalFixture(); let reached!: () => void, transportSignal: AbortSignal | undefined;
  const called = new Promise<void>(resolve => { reached = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    transportSignal = init!.signal!;
    return new Response(new ReadableStream({ start(controller) {
      transportSignal!.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true }); reached();
    } }), { headers: { "content-type": "application/json" } });
  }));
  vi.useFakeTimers();
  const pending = requestCircleWithdrawalTransfer(f.record, new AbortController().signal).then(() => false, () => true);
  await called; await vi.advanceTimersByTimeAsync(10001);
  expect(await pending).toBe(true); expect(transportSignal?.aborted).toBe(true);
});

it("keeps progress owner-scoped and excludes replayable material from the projection", async () => {
  const f = await creatorWithdrawalFixture();
  await submitWithdrawalTransfer(db, f.record, f.record.owner, async () => {}, async () => f.response, new AbortController().signal);
  expect(await withdrawalTransferProgress(other, f.record.id, `0x${"00".repeat(20)}`)).toBeNull();
  const progress = await withdrawalTransferProgress(other, f.record.id, f.record.owner);
  expect(progress).toEqual({ requestId: f.record.id, recipient: f.record.policy.recipient,
    amountMicros: f.record.request.burnIntent.spec.value, status: "attestation-stored", chainFinalityVerified: false });
  expect(JSON.stringify(progress)).not.toContain(f.record.request.signature);
  expect(JSON.stringify(progress)).not.toContain(f.response.attestation);
});

it("retains the single claim after an oversized vendor body and does not resend", async () => {
  const f = await creatorWithdrawalFixture();
  const fetcher = vi.fn(async () => Response.json({ ...f.response, padding: "x".repeat(16384) }));
  vi.stubGlobal("fetch", fetcher);
  for (const store of [db, other]) {
    expect(await submitWithdrawalTransfer(store, f.record, f.record.owner, async () => {}, requestCircleWithdrawalTransfer,
      new AbortController().signal)).toMatchObject({ status: "awaiting-transfer-evidence" });
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await db.getCreatorWithdrawalAttestation(f.record.id, f.record.owner)).toBeNull();
});
