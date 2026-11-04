import { afterEach, expect, it, vi } from "vitest";
import { runAgent, type RunInput } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { ReasoningEngine, SynthInput } from "../llm/reasoning-engine";
import { JsonChatEngine } from "../llm/json-chat-engine";
import * as bulletIntent from "../research/explicit-bullet-count";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";
import { prepareSpecialistBrief } from "../research/specialist-briefs";

// Synthetic facts and controlled reviewer judgments. This tests the real shared
// orchestrator and JsonChatEngine packets, not live model quality or user utility.
const facts = ["The synthetic queue stores accepted tasks.", "The synthetic queue retains completed tasks.", "The synthetic queue reports pending tasks."];
const vietnamese = ["Hàng đợi giả lập lưu các tác vụ đã nhận.", "Hàng đợi giả lập giữ các tác vụ đã hoàn tất.", "Hàng đợi giả lập báo cáo các tác vụ đang chờ."];
const targets = ["Accepted tasks", "Completed tasks", "Pending tasks"];
const url = "https://example.org/synthetic-queue";

class Transport extends JsonChatEngine {
  readonly name = "synthetic-bullet-transport";
  packets: Record<string, unknown>[] = [];
  constructor(private language: "en" | "vi", private reject = false) { super(); }
  protected async chatJson(_model: string, _system: string, user: string) {
    const packet = JSON.parse(user);this.packets.push(packet);
    if (this.packets.length === 1) return { evidence: facts.map((fact, claimIndex) => {
      const option = (packet.quoteOptions as { quoteId: string; text: string; marker: string }[]).find(row => row.text === fact)!;
      return { claimIndex, marker: option.marker, quoteId: option.quoteId, support: 0.9,
        statement: this.language === "vi" ? vietnamese[claimIndex] : fact };
    }), conflicts: [] };
    return { reviews: (packet.evidence as { index: number }[]).map(row => ({ index: row.index,
      supportedFact: facts[row.index], support: this.reject && row.index === 2 ? 0 : 0.9,
      statementSupport: 0.9, statementLanguage: this.language, questionScope: "direct", statementScope: "preserved" })) };
  }
}
afterEach(() => { vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers(); });

async function drive(question: string, options: { baseline?: boolean; reject?: boolean; private?: boolean; package?: boolean; teaching?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", options.teaching ? "1" : "0");
  const selector = options.baseline ? vi.spyOn(bulletIntent, "explicitBulletCount").mockReturnValue(undefined) : undefined;
  const language = /tiếng Việt/u.test(question) ? "vi" : "en", transport = new Transport(language, options.reject);
  const synthesize = vi.fn((input: SynthInput) => transport.synthesize(input));
  const attribute = vi.fn(async (input: { used: { sourceId: string }[] }) => input.used.map(row => ({ sourceId: row.sourceId, weight: 1, rationale: "Controlled factual contribution" })));
  const denied = vi.fn(async () => { throw new Error("Synthetic zero-budget fixture cannot move money"); });
  vi.stubGlobal("fetch", denied);
  const engine = { name: "synthetic-bullet-agent", decompose: async () => targets,
    decide: async (input: { candidates: { id: string; name: string }[] }) => input.candidates.map(row => ({ sourceId: row.id,
      sourceName: row.name, action: "BUY", price: 0, expectedValue: 0.9, confidence: 0.9, targets: [0, 1, 2], rationale: "Controlled public read" })),
    sufficiency: async () => ({ sufficient: !options.reject, rationale: "Controlled judgment", perClaim: targets.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) }),
    reevaluate: async () => ({ shouldBuyMore: false, recommendedIds: [], rationale: "No additional fixture read" }), synthesize, attribute } as unknown as ReasoningEngine;
  const queryId = options.private ? "prv_synthetic_bullet_count" : "synthetic-bullet-count";
  const effects: ResearchEffects = { scope: options.private ? { kind: "job", queryId } : { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: denied, saveQueryRun: vi.fn(async () => {}),
    saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const readMetadata: unknown[] = [];
  const read = vi.fn(async (finalUrl: string, signal?: AbortSignal, options?: Parameters<NonNullable<AgentDeps["readWebArticle"]>>[2]) => {
    readMetadata.push({ url: finalUrl, cancellationSignal: signal instanceof AbortSignal, abortedAtDispatch: signal?.aborted, options });
    return { finalUrl, text: facts.join("\n\n"), title: "Synthetic queue original", kind: "text" as const, truncated: false };
  });
  const deps: AgentDeps = { engine, effects, readWebArticle: read,
    db: { listSources: async () => [], listPublicReferences: async () => [] } as unknown as KeryxDB,
    webSearch: { search: vi.fn(async () => [{ title: "Synthetic queue original", url, snippet: "Unread discovery metadata, never evidence." }]) },
    gateway: { mode: "real", agentAddress: () => "0x0000000000000000000000000000000000000001", ensureFunded: denied, payFetch: denied, payCitation: denied } as unknown as PaymentGateway };
  const input: RunInput = { queryId, question, origin: "web", researchMode: "quick", budget: 0,
    ...(options.package ? { executionLimits: { attentionLimit: 1, reevaluateRounds: 0 } } : {}) };
  try {
    const iterator = runAgent(input, deps);let step = await iterator.next();while (!step.done) step = await iterator.next();
    return { run: step.value, transport, synthesize, attribute, denied, read, readMetadata, effects };
  } finally { selector?.mockRestore(); }
}

it.each([
  ["Explain queue behavior. Write exactly 3 bullets.", 3],
  ["Explain queue behavior. Write at most 4 bullets.", 3],
  ["Giải thích hành vi hàng đợi. Viết bằng tiếng Việt đúng 3 gạch đầu dòng.", 3],
  ["Giải thích hành vi hàng đợi. Viết bằng tiếng Việt tối đa 4 gạch đầu dòng.", 3],
])("projects only final delivery, with byte-identical factual/model/attribution inputs: %s", async (question, count) => {
  const baseline = await drive(question as string, { baseline: true }), current = await drive(question as string);
  expect(current.run.answer.match(/^- /gm)).toHaveLength(count as number);
  expect(baseline.run.answer).toMatch(/Research target 3|Yêu cầu nghiên cứu 3/u);
  expect(current.transport.packets).toEqual(baseline.transport.packets);
  expect(current.transport.packets).toHaveLength(2);
  expect(current.synthesize.mock.calls).toEqual(baseline.synthesize.mock.calls);
  expect(current.attribute.mock.calls).toEqual(baseline.attribute.mock.calls);
  expect(current.run.evidence).toEqual(baseline.run.evidence);expect(current.run.claimCoverage).toEqual(baseline.run.claimCoverage);
  expect(current.run.decisions).toEqual(baseline.run.decisions);expect(current.run.citations).toEqual(baseline.run.citations);
  expect(current.run.totalSpent).toBe(baseline.run.totalSpent);expect(current.run.totalToCreators).toBe(baseline.run.totalToCreators);
  expect(current.readMetadata).toEqual(baseline.readMetadata);expect(current.read).toHaveBeenCalledOnce();expect(current.denied).not.toHaveBeenCalled();
  for (const fact of facts) expect(current.run.answer).toContain(fact);
  expect(current.run.trace.find(row => row.message.startsWith("Final explicit bullet-count"))?.detail).toMatchObject({ outcome: "met" });
  const receipt = buildResearchReceipt(current.run, []);expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.dispatch.answer).toBe(current.run.answer);expect(researchReportMarkdown(current.run, null, [])).toContain(current.run.answer);
});

it.each(["Write exactly 4 bullets.", "Write at most 2 bullets."])("keeps every admitted fact and reports an unmet format: %s", async direction => {
  const question = `Explain queue behavior. ${direction}`, baseline = await drive(question, { baseline: true }), current = await drive(question);
  expect(current.run.answer).toContain("Could not present");expect(current.run.answer).toContain("Research target 3");
  for (const fact of facts) expect(current.run.answer).toContain(fact);
  expect(current.attribute.mock.calls).toEqual(baseline.attribute.mock.calls);expect(current.run.evidence).toEqual(baseline.run.evidence);
  expect(current.run.trace.find(row => row.message.startsWith("Final explicit bullet-count"))?.detail).toMatchObject({ outcome: "unmet" });
  expect(current.denied).not.toHaveBeenCalled();
});

it("does not hide a rejected target behind an upper bound", async () => {
  const current = await drive("Explain queue behavior. Write at most 4 bullets.", { reject: true });
  expect(current.run.answer).toContain("Research target 3");expect(current.run.answer).toContain("Evidence gap");
  expect(current.run.trace.find(row => row.message.startsWith("Final explicit bullet-count"))?.detail).toMatchObject({ outcome: "unmet" });
});

it.each([{ private: true }, { package: true }, { teaching: true }])("preserves the protected delivery path: %j", async options => {
  const current = await drive("Explain queue behavior. Write at most 4 bullets.", options);
  expect(current.run.trace.some(row => row.message.startsWith("Final explicit bullet-count"))).toBe(false);
  expect(current.denied).not.toHaveBeenCalled();
});

it("counts and retains supplied-original status rather than removing it to fit an exact count", async () => {
  const current = await drive(`Explain queue behavior from ${url}. Write exactly 3 bullets.`);
  expect(current.run.answer).toContain(url);expect(current.run.answer).toContain("Research target 3");
  expect(current.run.trace.find(row => row.message.startsWith("Final explicit bullet-count"))?.detail).toMatchObject({ outcome: "unmet" });
});

it("keeps a prepared custom brief on its bound work-product contract", async () => {
  const prepared = prepareSpecialistBrief({ track: "custom", decision: "Explain queue behavior.", context: "Synthetic workload; no execution requested.", sourceLeads: [url],
    deliverable: "Write at most 4 bullets.", reviewCriteria: ["Keep every factual limitation explicit."] });
  const current = await drive(prepared.request.question);
  expect(current.run.trace.some(row => row.message.startsWith("Final explicit bullet-count"))).toBe(false);
  expect(current.synthesize.mock.calls[0][0].workProductRequest).toMatchObject({ version: 1 });
  expect(current.denied).not.toHaveBeenCalled();
});

it("does not suppress an existing ordinary work-product request when a count also applies", async () => {
  // The prior work-product parser's literal length grammar does not cover these
  // extra spaces. Preserve that existing admission, not a new count-first gate.
  const question = "Hãy lập một kế hoạch cho hàng đợi giả lập. Viết bằng tiếng Việt tối đa 4 gạch   đầu dòng.";
  const baseline = await drive(question, { baseline: true }), current = await drive(question);
  expect(current.synthesize.mock.calls[0][0].workProductRequest).toMatchObject({ version: 2, criteria: [question] });
  expect(current.transport.packets).toEqual(baseline.transport.packets);
  expect(current.attribute.mock.calls).toEqual(baseline.attribute.mock.calls);
  expect(current.run.evidence).toEqual(baseline.run.evidence);expect(current.run.citations).toEqual(baseline.run.citations);
  expect(current.run.totalSpent).toBe(baseline.run.totalSpent);expect(current.run.totalToCreators).toBe(baseline.run.totalToCreators);
  expect(current.run.answer).toContain("bản nháp");
  expect(current.denied).not.toHaveBeenCalled();
});
