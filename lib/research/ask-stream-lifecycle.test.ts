import { afterEach, expect, it, vi } from "vitest";
import { ASK_STREAM_HEARTBEAT_MS, askStreamWriter, savedReportRecoveryPath } from "./ask-stream-lifecycle";

afterEach(() => { vi.useRealTimers(); });

function fixture() {
  const frames: string[] = [];
  const close = vi.fn();
  const enqueue = vi.fn((bytes: Uint8Array) => { frames.push(new TextDecoder().decode(bytes)); });
  const controller = { enqueue, close } as unknown as ReadableStreamDefaultController<Uint8Array>;
  const abort = new AbortController();
  return { frames, close, enqueue, abort, writer: askStreamWriter(controller, abort.signal) };
}

it("sends comments through long inference waits without extra agent events and stops on completion", () => {
  vi.useFakeTimers();
  const f = fixture();
  vi.advanceTimersByTime(ASK_STREAM_HEARTBEAT_MS * 9);
  expect(f.frames).toHaveLength(10);
  expect(f.frames.every(frame => frame.startsWith(":") && !frame.includes("event:"))).toBe(true);
  f.writer.send("done", { id: "original" });
  expect(f.frames.at(-1)).toBe('event: done\ndata: {"id":"original"}\n\n');
  f.writer.close();
  const count = f.frames.length;
  vi.advanceTimersByTime(ASK_STREAM_HEARTBEAT_MS * 2);
  f.writer.send("step", { message: "late" });
  expect(f.frames).toHaveLength(count);
  expect(f.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("stops delivery and clears heartbeat when the caller disconnects", () => {
  vi.useFakeTimers();
  const f = fixture();
  f.abort.abort();
  f.writer.send("sign-request", { reqId: "late" });
  vi.advanceTimersByTime(ASK_STREAM_HEARTBEAT_MS * 2);
  expect(f.frames).toEqual([": connected\n\n"]);
  expect(vi.getTimerCount()).toBe(0);
});

it("cleans up a cancelled reader and an already aborted request", () => {
  vi.useFakeTimers();
  const f = fixture();
  f.enqueue.mockImplementation(() => { throw new Error("reader closed"); });
  vi.advanceTimersByTime(ASK_STREAM_HEARTBEAT_MS);
  expect(vi.getTimerCount()).toBe(0);
  const abort = new AbortController(); abort.abort();
  const enqueue = vi.fn();
  askStreamWriter({ enqueue } as unknown as ReadableStreamDefaultController<Uint8Array>, abort.signal).send("meta", {});
  expect(enqueue).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("offers only a same-origin original report path for explicit link-readable visibility", () => {
  const reportId = "11111111-2222-4333-8444-555555555555";
  for (const visibility of ["public", "unlisted"]) expect(savedReportRecoveryPath({ reportId, visibility })).toBe(`/dispatch/${reportId}`);
  for (const visibility of [undefined, "private", "unknown"]) expect(savedReportRecoveryPath({ reportId, visibility })).toBeNull();
  for (const id of [null, "../../me", "https://example.com", `${reportId}?publish=1`, ""]) expect(savedReportRecoveryPath({ reportId: id, visibility: "public" })).toBeNull();
});
