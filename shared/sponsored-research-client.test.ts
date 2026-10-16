import { afterEach, describe, expect, it, vi } from "vitest";
import {
  researchSponsored, sponsoredResearchOrigin, SponsoredResearchError, SPONSORED_RESEARCH_TIMEOUT_MS,
  type SponsoredResearchInput,
} from "./sponsored-research-client";

const id = "12345678-1234-4123-8123-123456789abc";
const input: SponsoredResearchInput = { question: "A public question?", publicReport: true };
const meta = { queryId: id, dispatchUrl: `https://keryx.cc/dispatch/${id}`, citations: [] };
const chunk = (delta: object, extra: object = {}) => ({ id: `chatcmpl-${id}`, choices: [{ delta, finish_reason: null }], ...extra });
const terminal = (summary: object = meta) => chunk({}, { choices: [{ delta: {}, finish_reason: "stop" }], keryx: summary });
const frame = (value: unknown) => `data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`;
const complete = (summary: object = meta) => [chunk({ role: "assistant" }), chunk({ reasoning_content: "[discover] Reading evidence\n" }),
  chunk({ content: "A cited answer café." }), terminal(summary), "[DONE]"].map(frame).join("");

function streamResponse(text: string, split = 0, onCancel?: () => void) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += split || bytes.length) controller.enqueue(bytes.slice(i, i + (split || bytes.length)));
      controller.close();
    }, cancel: onCancel,
  }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

function transport(response: Response) { return vi.fn<typeof fetch>().mockResolvedValue(response); }
async function failure(response: Response) {
  const fetch = transport(response);
  const error = await researchSponsored(input, { fetch }).then(() => { throw new Error("unexpected success"); }, error => error);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(error).toBeInstanceOf(SponsoredResearchError);
  return error as SponsoredResearchError;
}

afterEach(() => vi.useRealTimers());

describe("hosted sponsored boundary", () => {
  it("posts the actual streaming contract with fixed anonymous headers and zero budget", async () => {
    const fetch = transport(streamResponse(complete())), onProgress = vi.fn();
    const result = await researchSponsored({ ...input, question: "  question  ", budget: 0, mode: "quick", headers: { Authorization: "secret" }, apiKey: "secret" } as SponsoredResearchInput,
      { fetch, onProgress, headers: { Cookie: "secret" }, apiKey: "secret" } as Parameters<typeof researchSponsored>[1]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://keryx.cc/api/v1/chat/completions");
    expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: "Bearer keryx" } });
    expect(Object.keys(init!.headers!)).toHaveLength(3);
    expect(JSON.parse(init!.body as string)).toEqual({ model: "keryx", stream: true, messages: [{ role: "user", content: "question" }],
      budget: 0, mode: "quick", publicReport: true });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith("[discover] Reading evidence\n");
    expect(result).toMatchObject({ ...meta, answer: "A cited answer café." });
  });

  it.each([
    { ...input, question: " " }, { ...input, question: "q".repeat(2001) }, { ...input, question: 2 },
    { ...input, publicReport: false }, { question: "question" }, { ...input, mode: "other" }, { ...input, mode: null },
    ...[NaN, Infinity, -Infinity, -0.001, 0.080001, "0", null].map(budget => ({ ...input, budget })),
  ])("rejects invalid input before fetching: %j", async invalid => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(researchSponsored(invalid as SponsoredResearchInput, { fetch })).rejects.toMatchObject({ code: "invalid_input", uncertain: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["https://keryx.cc", "https://keryx.cc/", "https://host.example:8443", "http://localhost:3939", "http://127.0.0.1:3939", "http://127.5.6.7:8080", "http://[::1]:3939"])("accepts safe origin %s", value => {
    expect(sponsoredResearchOrigin(value)).toBe(new URL(value).origin);
  });

  it.each(["http://keryx.cc", "http://localhost.evil", "https://u:p@keryx.cc", "https://@keryx.cc", "https://keryx.cc/api/v1", "https://keryx.cc/?x=1",
    "https://keryx.cc/#x", "https://keryx.cc?", "https://keryx.cc#", "file:///tmp", "ftp://keryx.cc", "javascript:alert(1)", " https://keryx.cc",
    "https://keryx.cc\n", "https://keryx.cc/./", "http://127.1:3939", "https://keryx.cc\\evil"])("refuses unsafe origin %s before fetching", async baseUrl => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(researchSponsored(input, { fetch, baseUrl })).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("public output", () => {
  it("keeps canonical evidence, exports and recorded payment state; strips private/account packets", async () => {
    const summary = { ...meta, paymentMode: "treasury", creatorsPaid: null, creatorsPaidAuthority: "distinct-settled-count-unavailable",
      totalToCreators: 0.012, pendingSpendUsdc: 0.003, operatingFee: { status: "pending", amountUsdc: 0.001 },
      citations: [{ sourceName: "An article", sourceId: "source-1", marker: 1, itemUrl: "https://evidence.example/article", rewardPlannedUsdc: 0.012,
        sourceClaim: { id: "claim-1", revision: 1 }, contentReceipt: { bodyHash: "abc", manifest: { canonicalUrl: "https://evidence.example/article", signature: "public-signature" } },
        accountTicket: "PRIVATE", keryx_private: { claimUrl: "https://keryx.cc/claim-run#PRIVATE" } }],
      evidence: [{ claimIndex: 0, quote: "Supported text", itemUrl: "https://evidence.example/article", qualifiesForReward: true }],
      subClaims: ["A claim"], claimCoverage: [{ claimIndex: 0, coverage: 1 }], readCheckpoints: { status: "unavailable" },
      researchExports: { bibtex: "@article{a}", ris: "TY  - JOUR", cslJson: "[]", evidenceCsv: "claim,source" },
      bibliographyExports: { cslJson: "[]", ris: { count: 0, content: "" } },
      reasoning: { telemetry: "recorded" }, outputLimits: [{ step: "synthesize", code: "output_limit" }],
      unknownServerField: "drop", keryx_private: { claimUrl: "PRIVATE" }, accountTickets: ["PRIVATE"] };
    const fetch = transport(streamResponse(complete(summary).replace(frame(terminal(summary)), frame({ ...terminal(summary), keryx_private: { claimUrl: "PRIVATE" } }))));
    const result = await researchSponsored(input, { fetch });
    expect(result).toMatchObject({ paymentMode: "treasury", creatorsPaid: null, totalToCreators: 0.012, pendingSpendUsdc: 0.003,
      operatingFee: { status: "pending" }, evidence: summary.evidence, researchExports: summary.researchExports, bibliographyExports: summary.bibliographyExports,
      citations: [{ sourceName: "An article", sourceUrl: "https://evidence.example/article", rewardPlannedUsdc: 0.012, sourceClaim: { id: "claim-1" },
        contentReceipt: { manifest: { signature: "public-signature" } } }] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|unknownServerField|accountTicket|keryx_private/);
  });

  it.each([`https://keryx.cc/ask/${id}`, `https://keryx.cc/dispatch/${id}`])("accepts the exact canonical report path %s", async dispatchUrl => {
    await expect(researchSponsored(input, { fetch: transport(streamResponse(complete({ ...meta, dispatchUrl }))) })).resolves.toMatchObject({ dispatchUrl });
  });

  it.each([`https://evil.example/dispatch/${id}`, `https://keryx.cc/dispatch/${id}?ticket=secret`, `https://keryx.cc/dispatch/${id}#secret`,
    `https://keryx.cc/dispatch/${id}?`, `https://keryx.cc/dispatch/${id}#`, `https://keryx.cc/dispatch/${id}/`,
    "https://keryx.cc/claim-run", "https://keryx.cc/dispatch/not-an-id", `https://keryx.cc/x/../dispatch/${id}`])("refuses unsafe or mismatched report URL %s", async dispatchUrl => {
    expect(await failure(streamResponse(complete({ ...meta, dispatchUrl })))).toMatchObject({ code: "invalid_response", queryId: id, uncertain: true });
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "file:///secret", "https://user:secret@evidence.example/a", "https://evidence.example/\narticle"])("rejects unsupported citation URL %s", async sourceUrl => {
    expect(await failure(streamResponse(complete({ ...meta, citations: [{ sourceName: "A", sourceUrl }] })))).toMatchObject({ code: "invalid_response" });
  });

  it("derives a public scholarly citation link without inventing settlement", async () => {
    const summary = { ...meta, citations: [{ sourceName: "Paper", scholarly: { recordUrl: "https://doi.org/10.1234/example" }, reward: 0 }] };
    const result = await researchSponsored(input, { fetch: transport(streamResponse(complete(summary))) });
    expect(result.citations[0]).toMatchObject({ sourceUrl: "https://doi.org/10.1234/example", reward: 0 });
    expect(result.creatorsPaid).toBeUndefined();
  });

  it("validates receipt URLs without changing the signed public string", async () => {
    const summary = { ...meta, citations: [{ sourceName: "Source", itemUrl: "https://evidence.example",
      contentReceipt: { manifest: { canonicalUrl: "https://evidence.example", signature: "public-proof" } } }] };
    const result = await researchSponsored(input, { fetch: transport(streamResponse(complete(summary))) });
    expect(result.citations[0]).toMatchObject({ sourceUrl: "https://evidence.example", contentReceipt: summary.citations[0].contentReceipt });
  });

  it("accepts the existing deterministic A2A public-report ID pattern", async () => {
    const queryId = `a2a_${"a".repeat(64)}`;
    const text = complete({ ...meta, queryId, dispatchUrl: `https://keryx.cc/dispatch/${queryId}` }).replaceAll(`chatcmpl-${id}`, `chatcmpl-${queryId}`);
    await expect(researchSponsored(input, { fetch: transport(streamResponse(text)) })).resolves.toMatchObject({ queryId });
  });
});

describe("SSE completion and refusal", () => {
  it("handles split UTF-8, CRLF and multiline data frames and emits plain progress", async () => {
    const text = complete().replaceAll("\n\n", "\r\n\r\n").replaceAll("Reading evidence", "Reading café\\u001b evidence");
    const onProgress = vi.fn();
    const result = await researchSponsored(input, { fetch: transport(streamResponse(text, 1)), onProgress });
    expect(result.answer).toBe("A cited answer café.");
    expect(onProgress).toHaveBeenCalledWith("[discover] Reading café evidence\n");
    const multiline = complete().replace(frame(terminal()), `data: ${JSON.stringify(terminal(), null, 2).replaceAll("\n", "\ndata: ")}\n\n`);
    await expect(researchSponsored(input, { fetch: transport(streamResponse(multiline, 7)) })).resolves.toMatchObject({ queryId: id });
  });

  it.each([
    frame(chunk({ content: "partial" })) + frame("[DONE]"),
    complete().replace(frame("[DONE]"), ""),
    frame(chunk({ content: "partial" })),
    frame("[DONE]"),
    complete().replace(frame(terminal()), frame(chunk({}, { choices: [{ delta: {}, finish_reason: "length" }] }))),
    complete().replace(frame(terminal()), frame(chunk({}, { choices: [{ delta: {}, finish_reason: "stop" }] }))),
  ])("requires canonical terminal data and DONE", async text => {
    expect(await failure(streamResponse(text))).toMatchObject({ uncertain: true });
  });

  it("retains original report identity and terminal diagnostics on server failure without retry", async () => {
    const selectionDiagnostic = { protocol: "keryx-source-selection-v1", stage: "decide", outcome: "refused", reasons: [{ code: "invalid_output" }] };
    const text = frame(chunk({ role: "assistant" })) + frame(chunk({ content: "\n\n[keryx error] Source selection refused." },
      { keryx_error: { code: "selection_refused", selectionDiagnostic, accountTicket: "PRIVATE" } }));
    const error = await failure(streamResponse(text));
    expect(error).toMatchObject({ code: "selection_refused", queryId: id, dispatchUrl: meta.dispatchUrl, uncertain: true, selectionDiagnostic });
    expect(error.message).toContain("Source selection refused");
    expect(error.message).toContain("server may still finish");
    expect(JSON.stringify(error)).not.toContain("PRIVATE");
  });

  it("detects the marker-only server error path", async () => {
    const error = await failure(streamResponse(frame(chunk({ content: "[keryx error] Planning failed." }))));
    expect(error).toMatchObject({ code: "research_failed", queryId: id });
    expect(error.message).toContain("Planning failed");
  });

  it("keeps the original ID when the terminal ID changes", async () => {
    const error = await failure(streamResponse(complete({ ...meta, queryId: "aaaaaaaa-1234-4123-8123-123456789abc" })));
    expect(error).toMatchObject({ queryId: id, dispatchUrl: meta.dispatchUrl });
  });

  it.each(["data: not JSON\n\n", frame({ choices: [] }) + frame("[DONE]"), complete() + frame(chunk({ content: "unexpected" }))])("refuses malformed/trailing events", async text => {
    expect(await failure(streamResponse(text))).toMatchObject({ uncertain: true });
  });

  it.each([
    [429, { error: "sponsored_rate_limit", message: "Capacity full.", retryAfter: 60 }, "sponsored_rate_limit"],
    [503, { error: { code: "research_paused", message: "Research paused." } }, "research_paused"],
  ] as const)("preserves HTTP %s code and Retry-After without retry", async (status, body, code) => {
    expect(await failure(Response.json(body, { status, headers: { "Retry-After": "60" } }))).toMatchObject({ status, code, retryAfter: "60", uncertain: false });
  });

  it("handles non-JSON HTTP errors and JSON Retry-After fallback", async () => {
    expect(await failure(new Response("bad gateway", { status: 502 }))).toMatchObject({ status: 502, code: "http_error", uncertain: true });
    expect(await failure(Response.json({ message: "Capacity", error: "sponsored_rate_limit", retryAfter: 12 }, { status: 429 }))).toMatchObject({ retryAfter: "12" });
  });

  it("retains canonical original-report identity when an HTTP error provides it", async () => {
    expect(await failure(Response.json({ error: { message: "Original refused", code: "refused", queryId: id, reportUrl: `https://keryx.cc/ask/${id}` } },
      { status: 503 }))).toMatchObject({ queryId: id, dispatchUrl: `https://keryx.cc/ask/${id}`, code: "refused" });
  });

  it("refuses redirects even if an injected transport ignores redirect:error", async () => {
    expect(await failure(new Response(null, { status: 307, headers: { Location: "https://evil.example" } }))).toMatchObject({ code: "redirect_refused" });
    const redirected = streamResponse(complete());
    Object.defineProperty(redirected, "redirected", { value: true });
    expect(await failure(redirected)).toMatchObject({ code: "redirect_refused" });
  });

  it("requires an SSE content type", async () => {
    expect(await failure(Response.json({ answer: "unexpected JSON" }))).toMatchObject({ code: "invalid_response", uncertain: true });
  });

  it("does not mistake an arbitrary content type prefix for SSE", async () => {
    const response = new Response(complete(), { headers: { "Content-Type": "text/event-stream-impostor" } });
    expect(await failure(response)).toMatchObject({ code: "invalid_response" });
  });
});

describe("bounded watching", () => {
  it("does not submit a pre-aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(researchSponsored(input, { fetch, signal: controller.signal })).rejects.toMatchObject({ code: "aborted", uncertain: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honors caller abort while a reader is pending and cancels it", async () => {
    const cancel = vi.fn(), controller = new AbortController();
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frame(chunk({ role: "assistant" })))) ; }, cancel }),
      { headers: { "Content-Type": "text/event-stream" } });
    const fetch = transport(response);
    const pending = researchSponsored(input, { fetch, signal: controller.signal });
    await vi.waitFor(() => expect(response.body?.locked).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted", uncertain: true, queryId: id, dispatchUrl: meta.dispatchUrl });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds a hung fetch even when transport ignores abort", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}));
    const pending = researchSponsored(input, { fetch });
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout", uncertain: true });
    await vi.advanceTimersByTimeAsync(SPONSORED_RESEARCH_TIMEOUT_MS);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds a hung stream after receiving its canonical identity", async () => {
    vi.useFakeTimers();
    const fetch = transport(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frame(chunk({ role: "assistant" })))); } }),
      { headers: { "Content-Type": "text/event-stream" } }));
    const pending = researchSponsored(input, { fetch });
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout", uncertain: true, queryId: id, dispatchUrl: meta.dispatchUrl });
    await vi.advanceTimersByTimeAsync(SPONSORED_RESEARCH_TIMEOUT_MS);
    await assertion;
  });

  it("reports disconnected responses as uncertain with the known report URL", async () => {
    let reads = 0;
    const response = new Response(new ReadableStream({ pull(c) {
      if (reads++ === 0) c.enqueue(new TextEncoder().encode(frame(chunk({ role: "assistant" })))); else c.error(new Error("socket closed"));
    } }), { headers: { "Content-Type": "text/event-stream" } });
    expect(await failure(response)).toMatchObject({ code: "transport_error", queryId: id, dispatchUrl: meta.dispatchUrl, uncertain: true });
  });

  it.each([
    "data: " + "x".repeat(1024 * 1024 + 1),
    frame(chunk({ content: "x".repeat(128 * 1024 + 1) })),
    frame(chunk({ reasoning_content: "x".repeat(256 * 1024 + 1) })),
    ": keepalive\n\n".repeat(4097),
    (": " + "x".repeat(1024 * 1024 - 16) + "\n\n").repeat(5),
  ])("bounds response frames, answer, progress, frame count and total body", async text => {
    expect(await failure(streamResponse(text))).toMatchObject({ code: "response_too_large", uncertain: true });
  });

  it("bounds HTTP failure bodies", async () => {
    expect(await failure(new Response("x".repeat(65537), { status: 429, headers: { "Retry-After": "9" } }))).toMatchObject({
      code: "response_too_large", status: 429, retryAfter: "9", uncertain: false,
    });
  });

  it("bounds terminal rows and recursion", async () => {
    expect(await failure(streamResponse(complete({ ...meta, citations: Array.from({ length: 4097 }, () => ({ sourceName: "A" })) })))).toMatchObject({ code: "response_too_large" });
    let nested: unknown = "leaf";
    for (let i = 0; i < 26; i++) nested = { child: nested };
    expect(await failure(streamResponse(complete({ ...meta, evidence: nested })))).toMatchObject({ code: "response_too_large" });
  });
});
