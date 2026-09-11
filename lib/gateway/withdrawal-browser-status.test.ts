import { afterEach, expect, it, vi } from "vitest";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalBrowserDraft } from "./withdrawal-browser-journal";
import { matchWithdrawalBrowserStatus, readWithdrawalBrowserStatus } from "./withdrawal-browser-status";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function fixture() {
  const f = await creatorWithdrawalFixture(), draft = createWithdrawalBrowserDraft(f.record.request.burnIntent, f.record.policy);
  return { draft, body: { wallet: draft.owner, requestId: draft.id, recipient: draft.policy.recipient,
    amountMicros: draft.burnIntent.spec.value, status: "attestation-stored", chainFinalityVerified: false, mintStatus: "not-checked" } };
}

it("binds wallet, amount, recipient and original ID without accepting claimed finality", async () => {
  const f = await fixture(); expect(matchWithdrawalBrowserStatus(f.draft, f.body)).toEqual(f.body);
  for (const delta of [{ wallet: `0x${"00".repeat(20)}` }, { recipient: `0x${"00".repeat(20)}` },
    { requestId: `0x${"00".repeat(32)}` }, { amountMicros: "1" }, { amountMicros: "050000" },
    { chainFinalityVerified: true }, { mintStatus: "completed" }, { signature: "private" }]) {
    expect(() => matchWithdrawalBrowserStatus(f.draft, { ...f.body, ...delta })).toThrow();
  }
});

it("posts only the private selector once to the fixed endpoint with no cache or redirects", async () => {
  const f = await fixture(), fetcher = vi.fn(async (url, init) => {
    expect(url).toBe("/api/me/withdrawals/status");
    expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "same-origin", cache: "no-store" });
    expect(JSON.parse(init.body)).toEqual({ id: f.draft.id }); return Response.json(f.body);
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await readWithdrawalBrowserStatus(f.draft, new AbortController().signal)).toMatchObject({ state: "observed-transfer", progress: f.body });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("accepts bound mint observations only with complete finality metadata", async () => {
  const f = await fixture();
  const observed = { ...f.body, mintStatus: "finalized-observed", chainFinalityVerified: true,
    transactionHash: `0x${"ab".repeat(32)}`, blockHash: `0x${"cd".repeat(32)}`, blockNumber: "9999",
    observedAt: new Date().toISOString(), finalityBasis: "operator-selected-rpc" };
  expect(matchWithdrawalBrowserStatus(f.draft, observed)).toEqual(observed);
  for (const delta of [{ transactionHash: "transfer-uuid" }, { finalityBasis: "independent-proof" },
    { mintStatus: "prepared" }, { chainFinalityVerified: false }, { blockNumber: "-1" }, { gasCostWei: "1" }])
    expect(() => matchWithdrawalBrowserStatus(f.draft, { ...observed, ...delta })).toThrow();
  for (const mintStatus of ["not-queued", "queued", "prepared"])
    expect(matchWithdrawalBrowserStatus(f.draft, { ...f.body, mintStatus }).chainFinalityVerified).toBe(false);
});

it("keeps absence distinct from failure and does not leak server diagnostics", async () => {
  const f = await fixture(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const [status, state] of [[401, "authentication-required"], [404, "unavailable"]] as const) {
    fetcher.mockResolvedValueOnce(Response.json({ error: "private server detail" }, { status }));
    expect(await readWithdrawalBrowserStatus(f.draft, new AbortController().signal)).toEqual({ state });
  }
  fetcher.mockResolvedValueOnce(Response.json({ error: "private server detail" }, { status: 503 }));
  await expect(readWithdrawalBrowserStatus(f.draft, new AbortController().signal)).rejects.toThrow(/^Withdrawal status unavailable; retain the original request$/);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("bounds response bytes and snapshots the original before transport can mutate its caller", async () => {
  const f = await fixture();
  vi.stubGlobal("fetch", vi.fn(async () => { f.draft.burnIntent.spec.value = "1"; return Response.json(f.body); }));
  expect(await readWithdrawalBrowserStatus(f.draft, new AbortController().signal)).toMatchObject({ state: "observed-transfer" });
  const next = await fixture(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...next.body, padding: "x".repeat(2048) })));
  await expect(readWithdrawalBrowserStatus(next.draft, new AbortController().signal)).rejects.toThrow("retain the original");
});

it("bounds stalled headers and caller abort even if a transport ignores its signal", async () => {
  const f = await fixture(); vi.useFakeTimers();
  const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
  const pending = readWithdrawalBrowserStatus(f.draft, new AbortController().signal).then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(5001); expect(await pending).toBe(true);
  const stop = new AbortController(), cancelled = readWithdrawalBrowserStatus(f.draft, stop.signal).then(() => false, () => true);
  stop.abort(); expect(await cancelled).toBe(true); expect(fetcher).toHaveBeenCalledTimes(2);
});

it("bounds a stalled body without granting a later successful response authority", async () => {
  const f = await fixture(); vi.useFakeTimers(); let controller!: ReadableStreamDefaultController;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(value) { controller = value; } }))));
  const pending = readWithdrawalBrowserStatus(f.draft, new AbortController().signal).then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(5001); expect(await pending).toBe(true);
  controller.enqueue(new TextEncoder().encode(JSON.stringify(f.body))); controller.close();
  await vi.advanceTimersByTimeAsync(1);
});
