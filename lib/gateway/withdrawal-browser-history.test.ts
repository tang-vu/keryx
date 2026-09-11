import { afterEach, expect, it, vi } from "vitest";
import { readWithdrawalBrowserHistory } from "./withdrawal-browser-history";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const owner = `0x${"11".repeat(20)}`, foreign = `0x${"22".repeat(20)}`;
const row = { id: `0x${"ab".repeat(32)}` as const, owner, recipient: owner,
  createdAt: "2026-09-11T14:00:00.123456+00:00", amountMicros: "50000", maxFeeMicros: "1000" };
const body = () => ({ wallet: owner, requests: [{ ...row }], nextCursor: null });
const read = () => readWithdrawalBrowserHistory(owner, () => owner, new AbortController().signal);

it("reads metadata without a wallet or local original and keeps selectors out of URLs", async () => {
  const fetcher = vi.fn(async (url, init) => {
    expect(url).toBe("/api/me/withdrawals/history");
    expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(JSON.parse(init.body)).toEqual({}); return Response.json(body());
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await read()).toEqual({ state: "server-history", page: body() });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("copies a cursor before transport and preserves submillisecond timestamp precision", async () => {
  const cursor = { createdAt: row.createdAt, id: `0x${"cd".repeat(32)}` as const }, original = { ...cursor };
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    cursor.createdAt = "invalid"; expect(JSON.parse(init.body)).toEqual({ cursor: original });
    return Response.json({ ...body(), nextCursor: { id: row.id, createdAt: row.createdAt } });
  }));
  expect(await readWithdrawalBrowserHistory(owner, () => owner, new AbortController().signal, cursor))
    .toMatchObject({ state: "server-history", page: { nextCursor: { createdAt: row.createdAt } } });
});

it("rejects foreign identities, duplicate pages, invalid amounts, and looping cursors", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const value of [
    { ...body(), wallet: foreign }, { ...body(), requests: [{ ...row, owner: foreign }] },
    { ...body(), requests: [row, row] }, { ...body(), requests: [{ ...row, amountMicros: "050000" }] },
    { ...body(), nextCursor: { id: `0x${"cd".repeat(32)}`, createdAt: row.createdAt } },
  ]) {
    fetcher.mockResolvedValueOnce(Response.json(value)); await expect(read()).rejects.toThrow("history unavailable");
  }
  fetcher.mockResolvedValueOnce(Response.json(body()));
  await expect(readWithdrawalBrowserHistory(owner, () => owner, new AbortController().signal,
    { id: row.id, createdAt: row.createdAt })).rejects.toThrow("history unavailable");
});

it("withholds data after account changes and does not fetch for an already mismatched account", async () => {
  let selected = owner;
  const fetcher = vi.fn(async () => { selected = foreign; return Response.json(body()); }); vi.stubGlobal("fetch", fetcher);
  for (let i = 0; i < 2; i++) await expect(readWithdrawalBrowserHistory(owner, () => selected, new AbortController().signal))
    .rejects.toThrow("history unavailable");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("distinguishes signed-out and empty history from failures without exposing diagnostics", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValueOnce(Response.json({ error: "private marker" }, { status: 401 }));
  expect(await read()).toEqual({ state: "authentication-required" });
  fetcher.mockResolvedValueOnce(Response.json({ wallet: owner, requests: [], nextCursor: null }));
  expect(await read()).toMatchObject({ state: "server-history", page: { requests: [] } });
  for (const status of [404, 429, 503]) {
    fetcher.mockResolvedValueOnce(Response.json({ error: "private marker" }, { status }));
    await expect(read()).rejects.toThrow(/^Withdrawal history unavailable\. Your saved requests have not been changed\.$/);
  }
  fetcher.mockResolvedValueOnce(Response.json({ ...body(), padding: "x".repeat(16384) }));
  await expect(read()).rejects.toThrow("history unavailable");
});

it("bounds stalled transport and body reads and rejects late data after cancellation", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  const stalled = read().then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(5001); expect(await stalled).toBe(true);
  let stream!: ReadableStreamDefaultController;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { stream = controller; } }))));
  const stop = new AbortController();
  const cancelled = readWithdrawalBrowserHistory(owner, () => owner, stop.signal).then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(1); stop.abort(); expect(await cancelled).toBe(true);
  stream.enqueue(new TextEncoder().encode(JSON.stringify(body()))); stream.close();
  await vi.advanceTimersByTimeAsync(1);
});
