import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerMarkdown } from "../../components/keryx/answer-markdown";
import { runAgent, type RunInput } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { ReasoningEngine, SynthInput } from "../llm/reasoning-engine";
import { JsonChatEngine } from "../llm/json-chat-engine";
import { prepareSpecialistBrief } from "../research/specialist-briefs";
import type { WorkProductPacket } from "../research/work-products";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";
import { extractAnswerMarkers } from "./evidence-ledger";

// Fully synthetic source/transport/reviewer responses. The study caller mirrors
// the public history need; no fixture is a live IELTS answer or useful-model proof.
const cases = {
  study: { question: "我想知道你对雅思口语的准备有什么建议吗 我还有一个月考试 可以怎样准备？目标是口语7分", deliverable: "A proposed four-week speaking practice plan; no band guarantee.",
    context: "Current level and daily practice time are unknown.", fact: "The synthetic speaking task includes a short prepared talk.",
    sections: Array.from({ length: 4 }, (_v, index) => ({ id: `w${index + 1}`, heading: `第${index + 1}周的建议`, text: "建议录制一段练习回答，再对照已列出的任务要求复查。该安排不保证考试成绩。", premiseIds: ["e1"], conditions: ["若有录音和复查时间，可调整练习安排。"] })) },
  operations: { question: "Propose a safe retry investigation checklist for a small email service.", deliverable: "A proposed checklist with unknown provider behavior explicit.",
    context: "An isolated test environment may be available.", fact: "The synthetic queue can deliver the same message more than once.",
    sections: [{ id: "w1", heading: "Proposed repeated-delivery check", text: "Propose a controlled repeated-delivery test before choosing a retry procedure.", premiseIds: ["e1"], conditions: ["If an isolated nonproduction environment is available."] }] },
  comparison: { question: "Compare two documented storage choices for our small service.", deliverable: "A comparison note with conditional verification steps.",
    context: "The workload and restore objectives remain unknown.", fact: "The synthetic storage comparison leaves restore performance unmeasured.",
    sections: [{ id: "w1", heading: "Proposed comparison criterion", text: "Keep restore performance undecided and propose comparing both choices against the same restore objective.", premiseIds: ["e1"], conditions: ["If a common workload and restore objective can be agreed."] }] },
};
type Case = keyof typeof cases;
afterEach(() => { vi.unstubAllEnvs();vi.useRealTimers(); });

class Transport extends JsonChatEngine {
  readonly name = "synthetic-work-product-transport";
  packets: Record<string, unknown>[] = [];
  constructor(private sample: typeof cases[Case], private reject: boolean, private unmetCriterion = false) { super(); }
  protected async chatJson(_model: string, _system: string, user: string) {
    const packet = JSON.parse(user);this.packets.push(packet);
    if (this.packets.length === 1) {
      const option = (packet.quoteOptions as { quoteId: string; text: string; marker: string }[]).find(row => row.text === this.sample.fact)!;
      return { evidence: [{ claimIndex: 0, marker: option.marker, quoteId: option.quoteId, support: 0.9, statement: this.sample.fact }], conflicts: [],
        workProductSections: this.sample.sections };
    }
    const product = packet.workProduct as WorkProductPacket | undefined;
    return { reviews: (packet.evidence as { index: number }[]).map(row => ({ index: row.index, supportedFact: this.sample.fact, support: 0.9, statementSupport: 0.9 })),
      ...(product ? { workProductReview: { digest: product.digest, sections: product.sections.map(row => ({ id: row.id, premiseIds: row.premiseIds,
        premiseConsistency: "supported", proposalOnly: "supported", scope: this.reject ? "unsupported" : "supported", conditions: "supported", language: "supported" })),
        criteria: product.request.criteria.map((_v, index) => ({ index, status: this.unmetCriterion ? "unsupported" : "supported" })) } } : {}) };
  }
}
async function drive(kind: Case, options: { plain?: boolean; reject?: boolean; losePremise?: boolean; changedOriginal?: boolean; teaching?: boolean; private?: boolean; ordinary?: boolean; unmetCriterion?: boolean; explicitLimit?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", options.teaching ? "1" : "0");
  const sample = cases[kind], url = "https://example.org/synthetic-original";
  const prepared = prepareSpecialistBrief({ track: "custom", decision: sample.question, context: sample.context, sourceLeads: [url],
    deliverable: sample.deliverable, reviewCriteria: ["Keep missing inputs and limitations explicit."] });
  const question = (options.ordinary ? sample.question : prepared.request.question) + (options.explicitLimit ? " Answer in exactly two sentences." : "");
  const denied = vi.fn(async () => { throw new Error("This synthetic zero-budget fixture cannot move money"); });
  const transport = new Transport(sample, options.reject ?? false, options.unmetCriterion ?? false), synthesize = vi.fn((value: SynthInput) =>
    transport.synthesize(options.plain ? { ...value, workProductRequest: undefined } : value));
  const attribute = vi.fn(async (value: { used: { sourceId: string }[] }) => value.used.map(row => ({ sourceId: row.sourceId, weight: 1, rationale: "Synthetic factual contribution" })));
  const engine = { name: "synthetic-work-product-agent", decompose: async () => ["What does the synthetic source establish?"],
    decide: async (value: { candidates: { id: string; name: string }[] }) => value.candidates.map(row => ({ sourceId: row.id, sourceName: row.name,
      action: "BUY", price: 0, confidence: 0.9, expectedValue: 0.9, targets: [0], rationale: "Controlled exact public read" })),
    sufficiency: async () => ({ sufficient: !options.losePremise, rationale: "Synthetic judgment only", perClaim: [{ claim: "What does the synthetic source establish?", coverage: options.losePremise ? 0 : 0.9, coveredBy: ["S1"] }] }),
    reevaluate: async () => ({ shouldBuyMore: false, recommendedIds: [], rationale: "No extra fixture reads" }), synthesize, attribute } as unknown as ReasoningEngine;
  const queryId = options.private ? "prv_synthetic_work_product" : "synthetic-work-product";
  const effects: ResearchEffects = { scope: options.private ? { kind: "job", queryId } : { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: denied, saveQueryRun: vi.fn(async () => {}),
    saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const read = vi.fn(async (finalUrl: string) => ({ finalUrl, text: sample.fact, title: "Synthetic original only", kind: "text" as const, truncated: false }));
  const deps: AgentDeps = { engine, effects, db: { listSources: async () => [], listPublicReferences: async () => [] } as unknown as KeryxDB,
    readWebArticle: read, webSearch: { search: vi.fn(async () => options.ordinary ?
      [{ title: "Synthetic original only", url, snippet: "Unread synthetic search metadata; never evidence." }] : []) } as unknown as AgentDeps["webSearch"],
    gateway: { mode: "real", agentAddress: () => "0x0000000000000000000000000000000000000001", ensureFunded: denied, payFetch: denied, payCitation: denied } as unknown as PaymentGateway };
  const input: RunInput = { queryId, question, origin: "web", researchMode: "deep", budget: 0,
    executionLimits: { attentionLimit: 1, reevaluateRounds: 0 }, ...(options.changedOriginal ? { originalQuestion: "A different original caller request." } : {}) };
  const iterator = runAgent(input, deps);let step = await iterator.next();while (!step.done) step = await iterator.next();
  return { run: step.value, denied, read, synthesize, transport, attribute, effects };
}

it.each(["study", "operations", "comparison"] as const)("delivers a caller-requested %s draft after canonical attribution with the same source and monetary result", async kind => {
  const baseline = await drive(kind, { plain: true }), f = await drive(kind);
  expect(f.run.answer).toContain(cases[kind].sections[0].heading);expect(f.run.answer).toContain(cases[kind].sections[0].text);
  expect(f.run.answer).toContain(cases[kind].fact);expect(f.transport.calls).toHaveLength(2);expect(f.read).toHaveBeenCalledOnce();
  expect(f.attribute.mock.calls).toEqual(baseline.attribute.mock.calls);
  expect(f.run.citations).toEqual(baseline.run.citations);expect(f.run.evidence).toEqual(baseline.run.evidence);expect(f.run.claimCoverage).toEqual(baseline.run.claimCoverage);
  expect([...extractAnswerMarkers(f.run.answer)]).toEqual([...extractAnswerMarkers(baseline.run.answer)]);
  expect(f.run.totalSpent).toBe(baseline.run.totalSpent);expect(f.run.totalToCreators).toBe(baseline.run.totalToCreators);expect(f.denied).not.toHaveBeenCalled();
  expect(f.synthesize.mock.calls[0][0].workProductRequest).toBeDefined();
  expect(f.attribute.mock.calls[0][0]).not.toHaveProperty("workProduct");
  const receipt = buildResearchReceipt(f.run, []);expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(JSON.stringify(receipt.payload)).toContain(cases[kind].sections[0].text);
  expect(JSON.stringify(receipt.payload)).not.toContain('"acceptedSectionIds"');
  expect(researchReportMarkdown(f.run, null, [])).toContain(cases[kind].sections[0].text);
  expect(renderToStaticMarkup(createElement(AnswerMarkdown, { text: f.run.answer, citations: f.run.citations }))).toContain(cases[kind].sections[0].heading);
});
it.each([{ reject: true }, { losePremise: true }])("withholds unsupported proposed text and preserves the ordinary answer on %j", async options => {
  const f = await drive("operations", options);expect(f.run.answer).not.toContain(cases.operations.sections[0].text);
  expect(f.run.answer).toContain("proposed draft was withheld");expect(f.denied).not.toHaveBeenCalled();expect(f.transport.calls).toHaveLength(2);
});
it.each([{ changedOriginal: true }, { teaching: true }, { private: true }])("does not let added context, teaching mode or private scope activate a new work product: %j", async options => {
  const f = await drive("operations", options);
  if (options.private) { expect(f.synthesize).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled(); }
  else { expect(f.synthesize).toHaveBeenCalledOnce();expect(f.synthesize.mock.calls[0][0].workProductRequest).toBeUndefined(); }
  expect(f.run.answer).not.toContain(cases.operations.sections[0].text);expect(f.denied).not.toHaveBeenCalled();
});

it.each(["study", "operations", "comparison"] as const)("delivers an ordinary %s request with complete caller scope and the same factual/financial result", async kind => {
  const baseline = await drive(kind, { ordinary: true, plain: true }), f = await drive(kind, { ordinary: true });
  const request = f.synthesize.mock.calls[0][0].workProductRequest!;
  expect(request).toMatchObject({ version: 2, criteria: [cases[kind].question] });
  expect(f.synthesize.mock.calls[0][0].question).toBe(cases[kind].question);
  expect(f.transport.packets[1].workProduct).toMatchObject({ originalQuestion: cases[kind].question, request });
  expect(f.run.answer).toContain(cases[kind].sections[0].text);expect(f.transport.calls).toHaveLength(2);expect(f.read).toHaveBeenCalledOnce();
  expect(f.attribute.mock.calls).toEqual(baseline.attribute.mock.calls);expect(f.run.evidence).toEqual(baseline.run.evidence);
  expect(f.run.citations).toEqual(baseline.run.citations);expect(f.run.claimCoverage).toEqual(baseline.run.claimCoverage);
  expect(f.run.totalSpent).toBe(baseline.run.totalSpent);expect(f.run.totalToCreators).toBe(baseline.run.totalToCreators);
  expect(f.denied).not.toHaveBeenCalled();expect(f.attribute.mock.calls[0][0]).not.toHaveProperty("workProduct");
  expect(verifyResearchReceipt(buildResearchReceipt(f.run, [])).valid).toBe(true);
});
it.each([{ reject: true }, { losePremise: true }])("withholds ordinary proposals after rejected review or lost factual premises: %j", async options => {
  const f = await drive("operations", { ...options, ordinary: true });
  expect(f.run.answer).not.toContain(cases.operations.sections[0].text);expect(f.denied).not.toHaveBeenCalled();expect(f.transport.calls).toHaveLength(2);
});
it("cannot promote a partial ordinary draft to completion when the full original criterion is rejected", async () => {
  const f = await drive("operations", { ordinary: true, unmetCriterion: true });
  expect(f.run.answer).toContain(cases.operations.sections[0].text);
  expect(f.run.answer).toContain("Some requested parts remain unverified.");expect(f.denied).not.toHaveBeenCalled();expect(f.transport.calls).toHaveLength(2);
});
it.each([{ changedOriginal: true }, { teaching: true }, { private: true }, { explicitLimit: true }])("preserves ordinary caller and protected-format gates: %j", async options => {
  const f = await drive("operations", { ...options, ordinary: true });
  if (options.private) { expect(f.synthesize).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled(); }
  else expect(f.synthesize.mock.calls[0][0].workProductRequest).toBeUndefined();
  expect(f.run.answer).not.toContain(cases.operations.sections[0].text);expect(f.denied).not.toHaveBeenCalled();
});
