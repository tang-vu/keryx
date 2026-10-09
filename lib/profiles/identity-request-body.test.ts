import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyIdentityRequestBody } from "./identity-request-body";
const request = (body?: ReadableStream<Uint8Array> | string, signal?: AbortSignal) => new Request("https://app.synthetic.invalid", {
  method: "POST", body, signal, ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
} as RequestInit);
afterEach(() => vi.useRealTimers());

describe("identity mutation zero-byte body contract", () => {
  it("accepts null and zero-byte EOF, including empty chunks before EOF", async () => {
    expect(await emptyIdentityRequestBody(request())).toBe(true);
    for (const count of [0, 1, 15]) {
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        for (let chunk = 0; chunk < count; chunk++) controller.enqueue(new Uint8Array());
        controller.close();
      } });
      expect(await emptyIdentityRequestBody(request(body))).toBe(true); expect(body.locked).toBe(false);
    }
  });
  it.each([" ", "{}", "\u0000"])("rejects actual payload %j even with Content-Length zero", async value => {
    const input = request(value); input.headers.set("content-length", "0");
    expect(await emptyIdentityRequestBody(input)).toBe(false);
  });
  it("refuses the first nonzero chunk without draining later payload or awaiting cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel });
    expect(await emptyIdentityRequestBody(request(body))).toBe(false); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
  });
  it("bounds empty-chunk reads even when a synchronous producer cannot yield to timers", async () => {
    const cancel = vi.fn(), pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => controller.enqueue(new Uint8Array()));
    const body = new ReadableStream<Uint8Array>({ pull, cancel });
    expect(await emptyIdentityRequestBody(request(body))).toBe(false);
    expect(pull.mock.calls.length).toBeLessThanOrEqual(17); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
  });
  it("refuses errored, locked and already-used streams", async () => {
    const errored = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("synthetic stream error")); } });
    expect(await emptyIdentityRequestBody(request(errored))).toBe(false);
    const locked = request(new ReadableStream<Uint8Array>()), reader = locked.body!.getReader();
    expect(await emptyIdentityRequestBody(locked)).toBe(false); reader.releaseLock(); await locked.body!.cancel();
    const used = request("payload"); await used.text(); expect(await emptyIdentityRequestBody(used)).toBe(false);
  });
  it("refuses an already-aborted request including a null body", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await emptyIdentityRequestBody(request(undefined, controller.signal))).toBe(false);
  });
  it("stops on request abort while cancellation never resolves", async () => {
    const controller = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel }), input = request(body, controller.signal);
    const result = emptyIdentityRequestBody(input); controller.abort();
    expect(await result).toBe(false); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
  });
  it("enforces one five-second total deadline despite a hostile cancellation promise", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {})), body = new ReadableStream<Uint8Array>({ cancel });
    const result = emptyIdentityRequestBody(request(body)); await vi.advanceTimersByTimeAsync(4999);
    expect(cancel).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(false); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects elapsed monotonic budget even before the timeout callback executes", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValue(5100);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    try { expect(await emptyIdentityRequestBody(request(body))).toBe(false); } finally { now.mockRestore(); }
  });
  it("catches cancellation rejection without changing payload refusal", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { throw new Error("synthetic cancellation error"); } });
    expect(await emptyIdentityRequestBody(request(body))).toBe(false); expect(body.locked).toBe(false);
  });
  it("refuses a non-byte custom stream chunk even when it claims byteLength zero", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue({ byteLength: 0 } as Uint8Array); controller.close(); } });
    expect(await emptyIdentityRequestBody(request(body))).toBe(false);
  });
});
