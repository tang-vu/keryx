import { afterEach, expect, it, vi } from "vitest";
import { createPublicClient, toHex } from "viem";
import { withdrawalRpcTransport } from "./withdrawal-rpc-transport";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const client = (signal = new AbortController().signal) => createPublicClient({
  transport: withdrawalRpcTransport("https://rpc.synthetic.invalid", signal) });

it("decodes a bounded JSON-RPC response without exposing endpoint credentials", async () => {
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: body.id, result: toHex(5042002) });
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await client().getChainId()).toBe(5042002); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(() => withdrawalRpcTransport("https://user:secret@rpc.synthetic.invalid", new AbortController().signal)).toThrow("Withdrawal RPC unavailable");
});

it.each(["headers", "body"])("aborts stalled %s at the per-request deadline with no retry", async phase => {
  let reached!: () => void, transportSignal: AbortSignal | undefined;
  const called = new Promise<void>(resolve => { reached = resolve; });
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    transportSignal = init!.signal!;
    if (phase === "headers") return await new Promise<Response>((_resolve, reject) => {
      transportSignal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); reached();
    });
    return new Response(new ReadableStream({ start(controller) {
      transportSignal!.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true }); reached();
    } }), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetcher); vi.useFakeTimers();
  const pending = client().getChainId().then(() => false, () => true);
  await called; await vi.advanceTimersByTimeAsync(5001);
  expect(await pending).toBe(true); expect(transportSignal?.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
});

it("forwards worker cancellation while reading the response body", async () => {
  let reached!: () => void;
  const called = new Promise<void>(resolve => { reached = resolve; });
  const stop = new AbortController(), fetcher = vi.fn(async (_input: unknown, init?: RequestInit) =>
    new Response(new ReadableStream({ start(controller) {
      init!.signal!.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true }); reached();
    } })));
  vi.stubGlobal("fetch", fetcher);
  const pending = client(stop.signal).getChainId().then(() => false, () => true);
  await called; stop.abort();
  expect(await pending).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
});

it("cancels oversized bodies before JSON parsing", async () => {
  let cancelled = false;
  const fetcher = vi.fn(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(client().getChainId()).rejects.toThrow();
  expect(cancelled).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
});
