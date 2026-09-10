import { describe, expect, it, vi } from "vitest";
import { readMcpBody } from "./request-body";

describe("MCP body limits", () => {
  it("accepts the byte limit and rejects chunked overflow without trusting headers", async () => {
    expect(await readMcpBody(new Request("https://example.test", { method: "POST", body: '"' + "a".repeat(65534) + '"' }))).toHaveLength(65534);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(40000)); controller.enqueue(new Uint8Array(40000)); },
      cancel() { cancelled = true; },
    });
    const req = new Request("https://example.test", { method: "POST", body: stream, duplex: "half", headers: { "content-length": "1" } } as RequestInit);
    await expect(readMcpBody(req)).rejects.toThrow("Invalid MCP body");
    expect(cancelled).toBe(true);
  });

  it("returns at the deadline even when stream cancellation never resolves", async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise(() => {}); } });
      const req = new Request("https://example.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
      const result = expect(readMcpBody(req)).rejects.toThrow("Invalid MCP body");
      await vi.advanceTimersByTimeAsync(5000);
      await result;
      expect(cancelled).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("rejects invalid UTF-8 rather than replacing bytes", async () => {
    await expect(readMcpBody(new Request("https://example.test", { method: "POST", body: new Uint8Array([34, 255, 34]) }))).rejects.toThrow();
  });
});
