import { describe, expect, it } from "vitest";
import { hostedReportUrl, publicPageUrl, readResearchStream, researchQuestion,
  responseError, sourceBudget, webDraftUrl } from "../../extension/research-client.mjs";
import { MAX_ASK_QUESTION_CHARS } from "../ask-input";

const origin = "https://keryx.cc";
const report = `${origin}/dispatch/12345678-1234-1234-1234-123456789abc`;
const terminal = { choices: [{ delta: {}, finish_reason: "stop" }], keryx: { citations: [] } };
const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;

describe("extension hosted request boundaries", () => {
  it("preserves zero, rejects invalid budgets and mirrors the editable web cap", () => {
    expect(sourceBudget("0")).toBe(0);
    expect(sourceBudget("0.08")).toBe(0.08);
    for (const value of ["", " ", "NaN", "Infinity", "-1", "0.081"]) expect(() => sourceBudget(value)).toThrow();
  });
  it("sends page context only after an explicit opt-in, with the shared question limit", () => {
    expect(researchQuestion(" question ", "https://example.com/page#section", false)).toBe("question");
    expect(researchQuestion("question", "https://example.com/page#section", true)).toBe("question\n\nSource page to consider: https://example.com/page");
    expect(researchQuestion("q".repeat(MAX_ASK_QUESTION_CHARS), "", false)).toHaveLength(MAX_ASK_QUESTION_CHARS);
    expect(() => researchQuestion("q".repeat(MAX_ASK_QUESTION_CHARS + 1), "", false)).toThrow();
    expect(() => researchQuestion("question", "chrome://settings", true)).toThrow();
    for (const url of ["javascript:alert(1)", "https://user:secret@example.com", "https://example.com/\nsecret"]) expect(publicPageUrl(url)).toBeNull();
  });
  it("bounds original reports to the hosted origin and never auto-runs web handoffs", () => {
    expect(hostedReportUrl(report, origin)).toBe(report);
    const a2aReport = `${origin}/dispatch/a2a_${"a".repeat(64)}`;
    expect(hostedReportUrl(a2aReport, origin)).toBe(a2aReport);
    for (const url of [a2aReport + "/receipt", `${origin}/dispatch/a2a_short`, `${origin}/dispatch/prv_${"a".repeat(64)}`])
      expect(hostedReportUrl(url, origin)).toBeNull();
    for (const url of [report + "?run=1", report + "#x", report.replace(origin, "https://evil.example"), "https://keryx.cc/dispatch/not-a-uuid"]) expect(hostedReportUrl(url, origin)).toBeNull();
    const url = new URL(webDraftUrl(origin, "A & B", 0, "deep"));
    expect(url.searchParams.get("q")).toBe("A & B");
    expect(url.searchParams.get("budget")).toBe("0");
    expect(url.searchParams.get("mode")).toBe("deep");
    expect(url.searchParams.has("run")).toBe(false);
    expect(responseError({ error: { message: "Paused" } }, 503)).toBe("Paused");
    expect(responseError({ error: "sponsored_rate_limit", message: "Full" }, 429)).toBe("Full");
  });
});

describe("extension streamed completion", () => {
  it("reassembles every byte of split UTF-8 and CRLF and requires the final summary", async () => {
    const answer = { choices: [{ delta: { content: "Câu trả lời 🧪" } }] };
    const bytes = new TextEncoder().encode(event(answer) + event(terminal) + "data: [DONE]\r\n\r\n");
    const stream = new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    const chunks: unknown[] = [];
    await readResearchStream(new Response(stream), (chunk: unknown) => chunks.push(chunk));
    expect(chunks).toEqual([answer, terminal]);
    expect(stream.locked).toBe(false);
  });
  it("refuses HTTP-200 application errors, missing completion and malformed events", async () => {
    for (const body of [
      event({ choices: [{ delta: { content: "\n\n[keryx error] Cannot select sources" } }], keryx_error: { code: "selection" } }),
      event({ choices: [{ delta: { content: "[keryx error] Provider unavailable" } }] }),
      event(terminal), "data: [DONE]\n\n", "data: {bad}\n\n",
    ]) await expect(readResearchStream(new Response(body), () => {})).rejects.toThrow();
  });
});
