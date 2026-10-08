import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { observeArxivBibliographicPage } from "./arxiv-bibliography-page";
import { acquireParserSlot } from "../web-research/parser-slots";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function worker() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit("close", null)); return true; }) });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}
function released() { const release = acquireParserSlot(); release(); }
const html = "abcdefgh", unit = { value: "Observed", path: "head/meta", start: 0, end: 8, rawExcerpt: html };
const page = { metadata: { citation_title: [unit] }, versions: [], titles: [], statuses: [] };

it("contains the child heap/environment and kills it at the wall-time bound, releasing admission", async () => {
  vi.useFakeTimers(); const child = worker(), parsing = observeArxivBibliographicPage(html);
  const failure = expect(parsing).rejects.toThrow("invalid-metadata-read");
  expect(spawn).toHaveBeenCalledWith(process.execPath, ["--max-old-space-size=64", expect.stringMatching(/arxiv-bibliography-worker\.mjs$/u)],
    { windowsHide: true, env: { NODE_ENV: "production" }, stdio: ["pipe", "pipe", "ignore"] });
  await vi.advanceTimersByTimeAsync(1999); expect(child.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await failure; expect(child.kill).toHaveBeenCalledWith("SIGKILL"); released();
});

it("kills excess output and stdin failures, and accepts only closed field/provenance output", async () => {
  const oversized = worker(), parsing = observeArxivBibliographicPage(html), failure = expect(parsing).rejects.toThrow("invalid-metadata-read");
  oversized.stdout.write("é".repeat(100001)); await failure; expect(oversized.kill).toHaveBeenCalledWith("SIGKILL"); released();
  const broken = worker(), reading = observeArxivBibliographicPage(html), brokenFailure = expect(reading).rejects.toThrow("invalid-metadata-read");
  broken.stdin.emit("error", new Error("pipe failed")); await brokenFailure; released();
  for (const invalid of [
    { ...page, scientificEvidence: "forbidden" }, { ...page, metadata: { unrelated: [unit] } },
    { ...page, titles: [{ ...unit, rawExcerpt: "forged" }] }, { ...page, titles: [{ ...unit, end: 9 }] },
    { ...page, titles: [{ ...unit, rawExcerpt: undefined }] },
    { ...page, titles: [{ ...unit, overBound: true }] }, { ...page, titles: Array.from({ length: 150 }, () => unit) },
    { ...page, titles: [{ ...unit, unavailable: "hidden" }] },
  ]) {
    const child = worker(), observed = observeArxivBibliographicPage(html), invalidFailure = expect(observed).rejects.toThrow("invalid-metadata-read");
    child.stdout.write(JSON.stringify(invalid)); child.emit("close", 0); await invalidFailure; released();
  }
  const child = worker(), success = observeArxivBibliographicPage(html);
  child.stdout.write(JSON.stringify(page)); child.emit("close", 0); expect(await success).toEqual(page); released();
});
