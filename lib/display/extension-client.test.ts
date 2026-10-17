import { describe, expect, it } from "vitest";
import { hostedReportUrl, privateClaimDelivery, publicPageUrl, readResearchStream, researchQuestion,
  responseError, sourceBudget, webDraftUrl } from "../../extension/research-client.mjs";
import { MAX_ASK_QUESTION_CHARS } from "../ask-input";

const origin = "https://keryx.cc";
const report = `${origin}/dispatch/12345678-1234-1234-1234-123456789abc`;
const terminal = { choices: [{ delta: {}, finish_reason: "stop" }], keryx: { citations: [] } };
const privateTerminal = { ...terminal, keryx_private: { version: 1, runId: "12345678-1234-1234-1234-123456789abc", status: "available",
  delivery: { version: 1, claimUrl: `${origin}/claim-run#${"c".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z" } } };
const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;

describe("extension hosted request boundaries", () => {
  it("accepts only live run-bound private fragment packets, never report URLs", () => {
    const runId = "12345678-1234-1234-1234-123456789abc", claimUrl = `${origin}/claim-run#${"c".repeat(64)}`;
    const packet = { version: 1, runId, status: "available", delivery: { version: 1, claimUrl, expiresAt: new Date(Date.now() + 60000).toISOString() } };
    expect(privateClaimDelivery(packet, origin, runId)).toEqual({ claimUrl, expiresAt: packet.delivery.expiresAt });
    expect(hostedReportUrl(claimUrl, origin)).toBeNull();
    for (const value of [{ ...packet, runId: "other" }, { ...packet, token: "c".repeat(64) }, { ...packet, status: "unavailable" },
      { ...packet, delivery: { ...packet.delivery, expiresAt: new Date(Date.now() - 1).toISOString() } },
      { ...packet, delivery: { ...packet.delivery, claimUrl: claimUrl.replace(origin, "https://foreign.example") } },
      { ...packet, delivery: { ...packet.delivery, claimUrl: `${origin}/claim-run?token=${"c".repeat(64)}` } },
      { ...packet, delivery: { ...packet.delivery, token: "c".repeat(64) } }]) expect(privateClaimDelivery(value, origin, runId)).toBeNull();
    expect(privateClaimDelivery({ ...packet, runId: "prv_old" }, origin, "prv_old")).toBeNull();
  });
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
  it("completes and cancels after the terminal protocol without waiting for transport EOF", async () => {
    const answer = { choices: [{ delta: { content: "Complete answer" } }] };
    const bytes = new TextEncoder().encode(event(answer) + event(terminal) + "data: [DONE]\r\n\r\n");
    let source!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    let forcedClosure = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { source = controller; controller.enqueue(bytes); },
      cancel() { cancelled = true; },
    });
    // Close a regressed reader deterministically rather than leaving a pending test.
    const timeout = setTimeout(() => { forcedClosure = true; source.close(); }, 1000);
    const chunks: unknown[] = [];
    try {
      await readResearchStream(new Response(stream), (chunk: unknown) => chunks.push(chunk));
      expect(forcedClosure).toBe(false);
      expect(cancelled).toBe(true);
      expect(chunks).toEqual([answer, terminal]);
      expect(stream.locked).toBe(false);
    } finally { clearTimeout(timeout); }
  });
  it("keeps private delivery pending after the terminal protocol until clean transport EOF", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    let settled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { source = controller; controller.enqueue(new TextEncoder().encode(event(privateTerminal) + "data: [DONE]\r\n\r\n")); },
      cancel() { cancelled = true; },
    });
    const completion = readResearchStream(new Response(stream), () => {}).then(() => { settled = true; });
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      expect(cancelled).toBe(false);
      expect(stream.locked).toBe(true);
    } finally {
      if (!cancelled) source.close();
      await completion;
    }
    expect(settled).toBe(true);
    expect(stream.locked).toBe(false);
  });
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
  it("rejects data received after the terminal marker, including an unterminated trailing event", async () => {
    const extra = { choices: [{ delta: { content: "Unexpected answer" } }] };
    for (const summary of [terminal, privateTerminal]) {
      for (const trailing of [event(extra), `data: ${JSON.stringify(extra)}`]) {
        const body = event(summary) + "data: [DONE]\r\n\r\n" + trailing;
        await expect(readResearchStream(new Response(body), () => {})).rejects.toThrow("Unexpected data after the response ended.");
      }
    }
  });
  it("rejects private stream data arriving in a later read after the terminal marker", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      source = controller;
      controller.enqueue(new TextEncoder().encode(event(privateTerminal) + "data: [DONE]\r\n\r\n"));
    } });
    const completion = readResearchStream(new Response(stream), () => {});
    await new Promise(resolve => setTimeout(resolve, 0));
    source.enqueue(new TextEncoder().encode(event(terminal)));
    await expect(completion).rejects.toThrow("Unexpected data after the response ended.");
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
