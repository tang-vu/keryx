import { afterEach, expect, it, vi } from "vitest";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { sendWithdrawalBrowserOriginal as send } from "./withdrawal-browser-submit";
const sendWithdrawalBrowserOriginal = (record: Parameters<typeof send>[0], signal: AbortSignal) =>
  send(record, signal, () => signal.throwIfAborted());

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function fixture() {
  const { record } = await creatorWithdrawalFixture();
  return { record, body: { wallet: record.owner, requestId: record.id, recipient: record.policy.recipient,
    amountMicros: record.request.burnIntent.spec.value, status: "attestation-stored",
    chainFinalityVerified: false, mintStatus: "not-checked" } };
}

it("sends only the original signed wire once to the fixed same-origin endpoint", async () => {
  const f = await fixture(), wire = structuredClone(f.record.request);
  const fetcher = vi.fn(async (url, init) => {
    expect(url).toBe("/api/me/withdrawals/submit");
    expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "same-origin", cache: "no-store" });
    expect(JSON.parse(init.body)).toEqual(wire);
    f.record.request.burnIntent.spec.value = "1";
    return Response.json(f.body, { status: 202 });
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await sendWithdrawalBrowserOriginal(f.record, new AbortController().signal)).toEqual(f.body);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects invalid originals and prior cancellation before sending", async () => {
  const f = await fixture(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const stop = new AbortController(); stop.abort();
  await expect(send(f.record, new AbortController().signal, () => { throw new Error("Account changed"); })).rejects.toThrow();
  await expect(sendWithdrawalBrowserOriginal(f.record, stop.signal)).rejects.toThrow();
  f.record.request.burnIntent.spec.value = "1";
  await expect(sendWithdrawalBrowserOriginal(f.record, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not accept errors, misbound progress or claimed mint finality and never retries", async () => {
  const f = await fixture(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const [status, body] of [[401, { error: "private diagnostic" }], [503, { error: "private diagnostic" }],
    [200, f.body], [202, { ...f.body, amountMicros: "1" }], [202, { ...f.body, chainFinalityVerified: true }],
    [202, { ...f.body, padding: "x".repeat(2048) }]] as const) {
    fetcher.mockResolvedValueOnce(Response.json(body, { status }));
    await expect(sendWithdrawalBrowserOriginal(f.record, new AbortController().signal))
      .rejects.toThrow(/^Withdrawal submission unavailable; recover the original request$/);
  }
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it("bounds stalled headers and body even when a transport ignores cancellation", async () => {
  const f = await fixture(); vi.useFakeTimers();
  const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
  const pending = sendWithdrawalBrowserOriginal(f.record, new AbortController().signal).then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(30001); expect(await pending).toBe(true);
  let controller!: ReadableStreamDefaultController;
  fetcher.mockImplementation(async () => new Response(new ReadableStream({ start(value) { controller = value; } })));
  const body = sendWithdrawalBrowserOriginal(f.record, new AbortController().signal).then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(30001); expect(await body).toBe(true);
  controller.enqueue(new TextEncoder().encode(JSON.stringify(f.body))); controller.close();
  await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
});
