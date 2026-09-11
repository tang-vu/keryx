import { afterEach, expect, it, vi } from "vitest";
import { matchWithdrawalHistoryStatus, readWithdrawalHistoryStatus } from "./withdrawal-history-status";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const owner = `0x${"11".repeat(20)}`, foreign = `0x${"22".repeat(20)}`;
const row = { id: `0x${"ab".repeat(32)}` as const, owner, recipient: owner, amountMicros: "50000", maxFeeMicros: "1000",
  createdAt: "2026-09-11T14:00:00.123456Z" };
const body = { wallet: owner, requestId: row.id, recipient: owner, amountMicros: row.amountMicros,
  status: "awaiting-transfer-evidence", mintStatus: "not-checked", chainFinalityVerified: false };
const read = () => readWithdrawalHistoryStatus(row, () => owner, new AbortController().signal);

it("matches server progress to the chosen history identity and rejects unsupported finality claims", () => {
  expect(matchWithdrawalHistoryStatus(row, body)).toEqual(body);
  for (const delta of [{ wallet: foreign }, { requestId: `0x${"cd".repeat(32)}` }, { recipient: foreign }, { amountMicros: "1" },
    { chainFinalityVerified: true }, { mintStatus: "completed" }, { signature: "private" }])
    expect(() => matchWithdrawalHistoryStatus(row, { ...body, ...delta })).toThrow();
  const observed = { ...body, mintStatus: "finalized-observed", chainFinalityVerified: true,
    transactionHash: `0x${"cd".repeat(32)}`, blockHash: `0x${"ef".repeat(32)}`, blockNumber: "9999",
    observedAt: "2026-09-11T14:00:00Z", finalityBasis: "operator-selected-rpc" };
  expect(matchWithdrawalHistoryStatus(row, observed)).toEqual(observed);
  expect(() => matchWithdrawalHistoryStatus(row, { ...observed, finalityBasis: "independent-proof" })).toThrow();
});

it("posts only the ID once, requires no local original, and labels observations as server reports", async () => {
  const fetcher = vi.fn(async (url, init) => {
    expect(url).toBe("/api/me/withdrawals/status"); expect(JSON.parse(init.body)).toEqual({ id: row.id });
    expect(init).toMatchObject({ redirect: "error", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
    return Response.json(body);
  }); vi.stubGlobal("fetch", fetcher);
  expect(await read()).toEqual({ state: "server-reported-progress", progress: body }); expect(fetcher).toHaveBeenCalledTimes(1);
});

it("withholds old-account results and snapshots caller metadata before transport", async () => {
  const copied = { ...row }; let current = owner;
  vi.stubGlobal("fetch", vi.fn(async () => { copied.amountMicros = "1"; return Response.json(body); }));
  expect(await readWithdrawalHistoryStatus(copied, () => current, new AbortController().signal)).toMatchObject({ state: "server-reported-progress" });
  vi.stubGlobal("fetch", vi.fn(async () => { current = foreign; return Response.json(body); }));
  await expect(readWithdrawalHistoryStatus(row, () => current, new AbortController().signal)).rejects.toThrow("progress unavailable");
});

it("distinguishes missing records and revoked sessions while hiding diagnostics and oversized bodies", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const [status, state] of [[401, "authentication-required"], [404, "unavailable"]] as const) {
    fetcher.mockResolvedValueOnce(Response.json({ error: "private marker" }, { status })); expect(await read()).toEqual({ state });
  }
  fetcher.mockResolvedValueOnce(Response.json({ error: "private marker" }, { status: 503 }));
  await expect(read()).rejects.toThrow(/^Withdrawal progress unavailable\. No new request has been created\.$/);
  fetcher.mockResolvedValueOnce(Response.json({ ...body, padding: "x".repeat(2048) }));
  await expect(read()).rejects.toThrow("progress unavailable");
});

it("bounds stalled transport and cancellation without accepting late body data", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  const stalled = read().then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(5001); expect(await stalled).toBe(true);
  let stream!: ReadableStreamDefaultController;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(value) { stream = value; } }))));
  const controller = new AbortController();
  const cancelled = readWithdrawalHistoryStatus(row, () => owner, controller.signal).then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(1); controller.abort(); expect(await cancelled).toBe(true);
  stream.enqueue(new TextEncoder().encode(JSON.stringify(body))); stream.close(); await vi.advanceTimersByTimeAsync(1);
});
