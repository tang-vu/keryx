import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import * as binding from "./extraction-worker";
import { extractHtml } from "./html-reader";
import { extractPdfText } from "./pdf-reader";
import { acquireParserSlot } from "./parser-slots";
import { extractionFailure } from "./extraction-failure";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => { vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks(); });
const url = "https://example.org/source";
const html = `<main><p>${"Synthetic observed source text. ".repeat(8)}</p></main>`;
type Format = "html" | "pdf";
const formats = ["html", "pdf"] as const;
const invoke = (format: Format, signal?: AbortSignal) => format === "html" ? extractHtml(html, url, signal)
  : extractPdfText(new Uint8Array([1, 2]), { maxPages: 2, maxChars: 1000, timeoutMs: 5000, signal });
const released = () => { const release = acquireParserSlot();release(); };
function worker() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit("close", null));return true; }) });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);return child;
}
async function caught(promise: Promise<unknown>) { try { await promise;throw new Error("Expected failure"); } catch (error) { return error; } }

it.each(formats)("distinguishes input refusal and occupied admission without taking another slot: %s", async format => {
  const rejected = await caught(format === "html" ? extractHtml("x".repeat(2 * 1024 * 1024 + 1), url)
    : extractPdfText(new Uint8Array(0), { maxPages: 2, maxChars: 1000, timeoutMs: 5000 }));
  expect(extractionFailure(rejected)).toEqual({ format, reason: "input-rejected" });expect(spawn).not.toHaveBeenCalled();
  const release = acquireParserSlot();
  try { expect(extractionFailure(await caught(invoke(format)))).toEqual({ format, reason: "parser-busy" });expect(() => acquireParserSlot()).toThrow("busy"); }
  finally { release(); }
  released();
});
it.each(formats)("distinguishes immutable binding refusal from synchronous process creation failure: %s", async format => {
  const original = new Error("PRIVATE missing path");vi.spyOn(binding, "extractionWorker").mockImplementationOnce(() => { throw original; });
  const bindingError = await caught(invoke(format));expect(extractionFailure(bindingError)).toEqual({ format, reason: "worker-binding" });
  if (format === "html") expect(bindingError).toBe(original);
  expect(spawn).not.toHaveBeenCalled();released();
  vi.mocked(spawn).mockImplementationOnce(() => { throw original; });
  expect(extractionFailure(await caught(invoke(format)))).toEqual({ format, reason: "worker-start" });released();
});
it.each(formats)("retains the original heap, environment, pipes and precise timeout: %s", async format => {
  vi.useFakeTimers();const child = worker(), promise = caught(invoke(format));
  expect(spawn).toHaveBeenCalledWith(process.execPath, expect.arrayContaining(["--max-old-space-size=64"]),
    { windowsHide: true, env: { NODE_ENV: "production" }, stdio: ["pipe", "pipe", "ignore"] });
  const timeout = format === "html" ? 4000 : 5000;
  await vi.advanceTimersByTimeAsync(timeout - 1);expect(child.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(extractionFailure(await promise)).toEqual({ format, reason: "deadline" });
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");released();
});
it.each(formats)("observes asynchronous worker start and stdin failures without retaining vendor text: %s", async format => {
  for (const [event, reason] of [["start", "worker-start"], ["stdin", "worker-io"]] as const) {
    const child = worker(), promise = caught(invoke(format));
    (event === "start" ? child : child.stdin).emit("error", new Error("PRIVATE vendor error with /system/path"));
    const error = await promise;expect(extractionFailure(error)).toEqual({ format, reason });
    expect(JSON.stringify(extractionFailure(error))).not.toContain("PRIVATE");released();
  }
});
it.each(formats)("keeps the original output bound and first observed stop reason: %s", async format => {
  const child = worker(), promise = caught(invoke(format));
  child.stdout.write("x".repeat(format === "html" ? 400001 : 1000 * 6 + 2049));
  child.stdin.emit("error", new Error("later failure"));
  expect(extractionFailure(await promise)).toEqual({ format, reason: "output-limit" });expect(child.kill).toHaveBeenCalledWith("SIGKILL");released();
});
it.each(formats)("separates nonzero exit from invalid output without inferring a native/heap/document cause: %s", async format => {
  let child = worker(), promise = caught(invoke(format));child.emit("close", 134);
  expect(extractionFailure(await promise)).toEqual({ format, reason: "worker-exit" });released();
  child = worker();promise = caught(invoke(format));child.stdout.write('{"text":"PRIVATE malformed output"}');child.emit("close", 0);
  expect(extractionFailure(await promise)).toEqual({ format, reason: "invalid-output" });released();
});
it.each(formats)("preserves AbortError and does not misclassify cancellation as an extraction failure: %s", async format => {
  const controller = new AbortController(), child = worker(), promise = caught(invoke(format, controller.signal));controller.abort();
  const error = await promise;expect(error).toMatchObject({ name: "AbortError" });expect(extractionFailure(error)).toBeUndefined();
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");released();
});
