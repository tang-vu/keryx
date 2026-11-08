import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildChunk, buildCompletion, keryxMeta } from "../openai-compat";
import { remoteResearchResult } from "../mcp/remote-server";
import { buildResearchReceipt } from "../research-receipt";
import { a2aResponseFromRun } from "../a2a/result";
import { quoteA2aResearch } from "../a2a/pricing";
import type { Confidence, QueryRun } from "../types";
import { researchSponsored } from "../../shared/sponsored-research-client";
import { runSponsoredCli } from "../../scripts/ask-sponsored.mts";
import { registerSponsoredResearchTool } from "../../mcp/sponsored-research.mts";
import type { KeryxAnswer } from "../../mcp/keryx-buyer.mts";
import { presentationRun } from "./presentation.test-fixture";
import { surfaceResearch } from "./surface-result";
import { createStdioResearchHandler, remoteResearchText } from "./result-presentation";
import { livePresentationLocale, presentationLanguages } from "./presentation-language";
import { researchPresentationMessages } from "./presentation-messages";

const levels = ["High", "Moderate", "Low"] as const;
const origin = "https://confidence.example";
const id = "12345678-1234-4123-8123-123456789abc";
const input = { question: "A controlled public fixture question", publicReport: true as const, budget: 0 };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function run(level?: Confidence["level"]): QueryRun {
  return { ...presentationRun(), id, confidence: level ? {
    level, reason: `Recorded ${level} assessment: café 🌍; an estimate, not a guarantee.\nOriginal explanation.`,
  } : undefined };
}
function response(record: QueryRun, extra: Record<string, unknown> = {}): Response {
  // The test transport relocates only the report URL. Assessment metadata comes
  // from the actual API mapper; no model, payment, DB or hosted request is made.
  const meta = { ...keryxMeta(record), dispatchUrl: `${origin}/dispatch/${id}`, ...extra };
  const frames = [buildChunk(`chatcmpl-${id}`, "keryx", { content: record.answer }),
    buildChunk(`chatcmpl-${id}`, "keryx", {}, "stop", { keryx: meta })];
  const bytes = new TextEncoder().encode(frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n");
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 17) controller.enqueue(bytes.slice(offset, offset + 17));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}
afterEach(() => vi.restoreAllMocks());

it.each(levels)("keeps the recorded %s assessment in API and remote metadata without changing run/receipt/answer bytes", level => {
  const record = run(level), before = hash(record), receipt = buildResearchReceipt(record, []);
  // This constructs an existing A2A result from a controlled recorded-mode
  // fixture; it never invokes its gateway, receipt settlement or order runner.
  const a2a = a2aResponseFromRun({ ...record, paymentMode: "real", budget: 0.03 }, quoteA2aResearch(0.03, "deep"));
  for (const result of [surfaceResearch(record), keryxMeta(record), buildCompletion(record, "keryx").keryx, remoteResearchResult(record), a2a]) {
    expect(result).toHaveProperty("confidence", record.confidence);
    expect((result as { confidence?: Confidence }).confidence).not.toBe(record.confidence);
    expect(result.citations[0].reward).toBe(record.citations[0].reward);
  }
  expect(buildCompletion(record, "keryx").choices[0].message.content).toContain(record.answer);
  expect(hash(record)).toBe(before);
  expect(buildResearchReceipt(record, [])).toEqual(receipt);
});

it.each(levels)("retains %s confidence through actual fragmented API chunks and the sponsored client", async level => {
  const record = run(level), before = hash(record), fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(record));
  const result = await researchSponsored(input, { baseUrl: origin, fetch });
  expect(result).toHaveProperty("confidence", record.confidence);
  expect(result.answer).toBe(record.answer);
  expect(result.totalToCreators).toBe(record.totalToCreators);
  expect(result.paymentMode).toBe("offline");
  expect(fetch).toHaveBeenCalledOnce();
  expect(hash(record)).toBe(before);
});

it.each(levels)("retains the same %s assessment in actual CLI output without another request", async level => {
  const record = run(level), fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(record));
  const stdout = vi.fn(), stderr = vi.fn();
  const result = await runSponsoredCli(["--public", input.question, "--budget", "0", "--base-url", origin], {
    client: (value, options) => researchSponsored(value, { ...options, fetch }), stdout, stderr,
  });
  expect(result).toBe(0);
  const artifact = JSON.parse(stdout.mock.calls[0][0]);
  expect(artifact.confidence).toEqual(record.confidence);
  expect(artifact.answer).toBe(record.answer);
  expect(artifact.totalToCreators).toBe(record.totalToCreators);
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(levels)("retains %s in sponsored MCP structured/text output through the real SDK registration", async level => {
  const record = run(level), fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(record));
  const server = new McpServer({ name: "confidence-fixture", version: "1" });
  registerSponsoredResearchTool(server, { baseUrl: origin,
    executor: (value, options) => researchSponsored(value, { ...options, fetch }) });
  const client = new Client({ name: "confidence-caller", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const result = await client.callTool({ name: "ask_keryx_sponsored", arguments: input });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ confidence: record.confidence, answer: record.answer, totalToCreators: record.totalToCreators });
    expect(JSON.stringify(result.content)).toContain(`Recorded ${level} assessment`);
    expect(fetch).toHaveBeenCalledOnce();
  } finally { await client.close(); await server.close(); }
});

it.each(levels)("keeps %s in the paid stdio presentation's already-verified result without loading custody or repeating a request", async level => {
  const record = run(level), value: KeryxAnswer = { answer: record.answer, confidence: record.confidence,
    citations: [{ source: "Recorded source", reward: 0.000001 }], creatorsPaid: null, totalToCreators: 0.000001,
    feePaid: 0.01, amountPaid: "0.010001", status: "completed", queryId: id };
  const before = hash(value), ask = vi.fn(async () => value);
  const result = await createStdioResearchHandler(ask, origin)({ question: input.question });
  expect(result.structuredContent).toMatchObject({ confidence: record.confidence, answer: record.answer, amountPaid: "0.010001" });
  expect(result.content[0].text).toContain("Paid Keryx 0.010001 USDC");
  expect(ask).toHaveBeenCalledExactlyOnceWith(input.question, undefined);
  expect(hash(value)).toBe(before);
});

it("recovers the last existing verdict rather than replacing historical assessment or recalculating it", () => {
  const record = run();
  record.trace = [{ phase: "verdict", ts: 1, message: "old", detail: { level: "Low", reason: "Earlier recorded verdict." } },
    { phase: "verdict", ts: 2, message: "last", detail: { level: "Moderate", reason: "Last recorded verdict." } }];
  const before = hash(record);
  for (const result of [surfaceResearch(record), keryxMeta(record), remoteResearchResult(record)])
    expect(result).toHaveProperty("confidence", { level: "Moderate", reason: "Last recorded verdict." });
  expect(hash(record)).toBe(before);
});

it("keeps absent assessments absent through API/client and does not fabricate a Low MCP label", async () => {
  const record = run(), before = hash(record);
  for (const result of [surfaceResearch(record), keryxMeta(record), remoteResearchResult(record)])
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty("confidence");
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(record));
  expect(await researchSponsored(input, { baseUrl: origin, fetch })).not.toHaveProperty("confidence");
  const text = remoteResearchText(remoteResearchResult(record), livePresentationLocale({ requestedLanguage: "en" }));
  expect(text).not.toContain("Confidence:");
  expect(text).not.toContain("Low");
  expect(hash(record)).toBe(before); expect(fetch).toHaveBeenCalledOnce();
});

it.each(presentationLanguages)("%s remote presentation keeps the report link without an invented confidence label", language => {
  const record = run(), locale = livePresentationLocale({ requestedLanguage: language });
  const copy = researchPresentationMessages(locale.language), result = remoteResearchResult(record);
  const text = remoteResearchText(result, locale);
  expect(text).not.toContain(copy("confidence"));
  expect(text).toContain(`${copy("dispatch")} ${result.dispatchUrl}`);
  expect(text.startsWith(record.answer)).toBe(true);
});

it("keeps the existing synthetic evidence demotion ahead of stored or legacy High assessments", async () => {
  const record = run("High"); record.citations[0].evidenceProvenance = "synthetic-demo";
  record.trace = [{ phase: "verdict", ts: 1, message: "old", detail: { level: "High", reason: "Historical judgement." } }];
  const before = hash(record), expected = { level: "Low", reason: "Contains synthetic demo material; its measurements cannot support factual conclusions." };
  for (const result of [surfaceResearch(record), keryxMeta(record), remoteResearchResult(record)]) expect(result).toHaveProperty("confidence", expected);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(record));
  expect(await researchSponsored(input, { baseUrl: origin, fetch })).toHaveProperty("confidence", expected);
  expect(hash(record)).toBe(before); expect(fetch).toHaveBeenCalledOnce();
});

it("projects only recorded level/reason and ignores unrelated private or oversized auxiliary fields", async () => {
  const record = run("Moderate");
  const confidence = { ...record.confidence!, privateTicket: "PRIVATE-CREDENTIAL", credentials: { token: "PRIVATE-CREDENTIAL" },
    unrelated: Array.from({ length: 5000 }, () => "not public assessment") };
  const before = hash(confidence), fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(record, { confidence, accountTicket: "PRIVATE-CREDENTIAL" }));
  const result = await researchSponsored(input, { baseUrl: origin, fetch });
  expect(result).toHaveProperty("confidence", record.confidence);
  expect(Object.keys(result.confidence as object).sort()).toEqual(["level", "reason"]);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE-CREDENTIAL|privateTicket|credentials|unrelated/);
  expect(result.answer).toBe(record.answer); expect(fetch).toHaveBeenCalledOnce(); expect(hash(confidence)).toBe(before);
});

it.each([null, [], "High", { level: "Certain", reason: "unknown" }, { level: "High" }, { level: "Low", reason: 1 },
  { level: "Moderate", reason: {} }, { level: "High", reason: "x".repeat(256 * 1024 + 1) },
])("omits malformed optional assessment metadata while preserving the answer %#", async confidence => {
  const record = run(), fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(record, { confidence }));
  const result = await researchSponsored(input, { baseUrl: origin, fetch });
  expect(result).not.toHaveProperty("confidence");
  expect(result.answer).toBe(record.answer); expect(result.citations).toHaveLength(record.citations.length);
  expect(fetch).toHaveBeenCalledOnce();
});
