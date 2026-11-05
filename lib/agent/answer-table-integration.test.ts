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
import type { AnswerTablePacket } from "../research/answer-table";
import type { WorkProductPacket } from "../research/work-products";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";
import { extractAnswerMarkers } from "./evidence-ledger";

// Synthetic original/read/reviewer only. No provider call or customer quality claim.
const samples = {
  decision: { question: "Give a decision table for repeated message delivery: factual behavior, a proposed check and missing information.",
    fact: "The synthetic queue can deliver the same message more than once.", columns: ["Situation", "Source finding", "Proposed check", "Unknown"],
    label: "Repeated message", proposal: "Propose an isolated repeated-delivery test.", condition: "If an isolated test environment is available." },
  paper: { question: "Provide a short table of each synthetic paper's research problem and main claim. Keep unread details explicit.",
    fact: "The synthetic paper studies how retrieval changes answer generation.", columns: ["Paper", "Research finding", "Proposed reading check", "Unknown"],
    label: "Synthetic paper", proposal: "Propose reading the full methods before comparing results.", condition: "If the full methods can be retrieved." },
  combined: { question: "Produce a decision table plus a transaction outline for a queue. Preserve crash and idempotency unknowns.",
    fact: "The synthetic queue can deliver the same message more than once.", columns: ["Situation", "Source finding", "Proposed check", "Unknown"],
    label: "Repeated message", proposal: "Propose an isolated repeated-delivery test.", condition: "If an isolated test environment is available.",
    outline: "Propose checking the transaction boundary before choosing a job-claim procedure." },
  vi: { question: "Hãy tạo bảng so sánh dữ kiện, đề xuất kiểm tra và điều chưa biết về việc giao lại thông điệp.",
    fact: "Hàng đợi giả lập có thể giao lại cùng một thông điệp.", columns: ["Tình huống", "Dữ kiện", "Đề xuất", "Chưa biết"],
    label: "Giao lại thông điệp", proposal: "Đề xuất thử nghiệm việc giao lại trong môi trường cô lập.", condition: "Nếu có môi trường kiểm tra ngoài vận hành thực." },
};
type Sample = typeof samples[keyof typeof samples];
type Options = { plain?: boolean; reject?: boolean; losePremise?: boolean; changedOriginal?: boolean; teaching?: boolean; private?: boolean; limit?: boolean; engineOrigin?: boolean };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
class Transport extends JsonChatEngine {
  readonly name = "synthetic-answer-table-transport";
  packets: Record<string, unknown>[] = [];
  constructor(private sample: Sample, private reject: boolean) { super(); }
  protected async chatJson(_model: string, _system: string, user: string) {
    const packet = JSON.parse(user); this.packets.push(packet);
    if (this.packets.length === 1) {
      const option = (packet.quoteOptions as { quoteId: string; text: string; marker: string }[]).find(row => row.text === this.sample.fact)!;
      return { evidence: [{ claimIndex: 0, marker: option.marker, quoteId: option.quoteId, support: 0.9, statement: this.sample.fact }], conflicts: [],
        ...("outline" in this.sample ? { workProductSections: [{ id: "w1", heading: "Proposed transaction outline", text: this.sample.outline, premiseIds: ["e1"], conditions: [this.sample.condition] }] } : {}),
        answerTable: { columns: this.sample.columns, rows: [[{ kind: "label", text: this.sample.label }, { kind: "facts", evidenceIds: ["e1"] },
          { kind: "proposal", text: this.sample.proposal, premiseIds: ["e1"], conditions: [this.sample.condition] }, { kind: "unknown" }]] } };
    }
    const table = packet.answerTable as AnswerTablePacket | undefined;
    const product = packet.workProduct as WorkProductPacket | undefined;
    return { reviews: (packet.evidence as { index: number }[]).map(row => ({ index: row.index, supportedFact: this.sample.fact, support: 0.9, statementSupport: 0.9 })),
      ...(product ? { workProductReview: { digest: product.digest, sections: product.sections.map(row => ({ id: row.id, premiseIds: row.premiseIds,
        premiseConsistency: "supported", proposalOnly: "supported", scope: "supported", conditions: "supported", language: "supported" })),
        criteria: product.request.criteria.map((_v, index) => ({ index, status: "supported" })) } } : {}),
      ...(table ? { answerTableReview: { digest: table.digest, layout: this.reject ? "unsupported" : "supported",
        cells: table.table.rows.flatMap((row, ri) => row.map((_cell, ci) => [ri, ci, "supported", "supported", "supported", "supported"])) } } : {}) };
  }
}
async function drive(kind: keyof typeof samples, options: Options = {}) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", options.teaching ? "1" : "0");
  const sample = samples[kind], question = sample.question + (options.limit ? " Answer in exactly two sentences." : "");
  const denied = vi.fn(async () => { throw new Error("No real network or payment in synthetic table test"); }); vi.stubGlobal("fetch", denied);
  const transport = new Transport(sample, options.reject ?? false), synthesize = vi.fn((input: SynthInput) =>
    transport.synthesize(options.plain ? { ...input, answerTableRequest: undefined } : input));
  const attribute = vi.fn(async (input: { used: { sourceId: string }[] }) => input.used.map(row => ({ sourceId: row.sourceId, weight: 1, rationale: "Synthetic factual contribution" })));
  const engine = { name: "synthetic-table-agent", decompose: async () => ["What does the synthetic source establish?"],
    decide: async (input: { candidates: { id: string; name: string }[] }) => input.candidates.map(row => ({ sourceId: row.id, sourceName: row.name,
      action: "BUY", price: 0, confidence: 0.9, expectedValue: 0.9, targets: [0], rationale: "Controlled public read" })),
    sufficiency: async () => ({ sufficient: !options.losePremise, rationale: "Synthetic judgment", perClaim: [{ claim: "What does the synthetic source establish?", coverage: options.losePremise ? 0 : 0.9, coveredBy: ["S1"] }] }),
    reevaluate: async () => ({ shouldBuyMore: false, recommendedIds: [], rationale: "No extra reads" }), synthesize, attribute } as unknown as ReasoningEngine;
  const queryId = options.private ? "prv_synthetic_table" : "synthetic-table";
  const effects: ResearchEffects = { scope: options.private ? { kind: "job", queryId } : { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: denied, saveQueryRun: vi.fn(async () => {}),
    saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const read = vi.fn(async (finalUrl: string) => ({ finalUrl, text: sample.fact, title: "Synthetic original", kind: "text" as const, truncated: false }));
  const deps: AgentDeps = { engine, effects, db: { listSources: async () => [], listPublicReferences: async () => [] } as unknown as KeryxDB,
    readWebArticle: read, webSearch: { search: vi.fn(async () => [{ title: "Synthetic original", url: "https://example.org/synthetic-table", snippet: "Unread metadata, not evidence." }]) } as unknown as AgentDeps["webSearch"],
    gateway: { mode: "real", agentAddress: () => "0x0000000000000000000000000000000000000001", ensureFunded: denied, payFetch: denied, payCitation: denied } as unknown as PaymentGateway };
  const input: RunInput = { queryId, question, origin: options.engineOrigin ? "engine" : "web", researchMode: "deep", budget: 0,
    executionLimits: { attentionLimit: 1, reevaluateRounds: 0 }, ...(options.changedOriginal ? { originalQuestion: "A different original question." } : {}) };
  const iterator = runAgent(input, deps); let step = await iterator.next(); while (!step.done) step = await iterator.next();
  return { run: step.value, denied, read, synthesize, transport, attribute, effects };
}
it.each(["decision", "paper", "vi", "combined"] as const)("delivers %s table through actual orchestration with unchanged factual/financial attribution", async kind => {
  const base = await drive(kind, { plain: true }), f = await drive(kind), sample = samples[kind];
  expect(f.transport.calls).toHaveLength(2); expect(f.read).toHaveBeenCalledOnce(); expect(f.denied).not.toHaveBeenCalled();
  expect(f.transport.packets[1].answerTable).toMatchObject({ originalQuestion: sample.question });
  expect(f.attribute.mock.calls).toEqual(base.attribute.mock.calls); expect(f.run.evidence).toEqual(base.run.evidence);
  expect(f.run.citations).toEqual(base.run.citations); expect(f.run.claimCoverage).toEqual(base.run.claimCoverage);
  expect(f.run.totalSpent).toBe(base.run.totalSpent); expect(f.run.totalToCreators).toBe(base.run.totalToCreators);
  expect([...extractAnswerMarkers(f.run.answer)]).toEqual([...extractAnswerMarkers(base.run.answer)]);
  expect(f.run.answer).toContain(sample.proposal); expect(f.run.answer).toContain(sample.condition);
  const canonical = base.run.answer.slice(base.run.answer.indexOf("\n\n") + 2); expect(f.run.answer.endsWith(canonical)).toBe(true);
  expect(renderToStaticMarkup(createElement(AnswerMarkdown, { text: f.run.answer, citations: f.run.citations }))).toContain("<table");
  const receipt = buildResearchReceipt(f.run, []); expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(JSON.stringify(receipt.payload)).toContain(sample.proposal); expect(JSON.stringify(receipt.payload)).not.toContain('"acceptedCells"');
  expect(researchReportMarkdown(f.run, null, [])).toContain(f.run.answer);
  if (kind === "combined") {
    expect(f.run.answer).toContain(samples.combined.outline);
    expect(f.transport.packets[0]).toHaveProperty("workProductRequest"); expect(f.transport.packets[0]).toHaveProperty("answerTableRequest");
    expect(f.transport.packets[1]).toHaveProperty("workProduct"); expect(f.transport.packets[1]).toHaveProperty("answerTable");
  }
});
it.each([{ reject: true }, { losePremise: true }])("retains canonical answer and an honest unavailable-table notice for %j", async options => {
  const f = await drive("decision", options); expect(f.run.answer).not.toContain(samples.decision.proposal);
  expect(f.run.answer).toContain("A checked table could not be provided"); expect(f.denied).not.toHaveBeenCalled(); expect(f.transport.calls).toHaveLength(2);
});
it.each([{ changedOriginal: true }, { teaching: true }, { private: true }, { limit: true }, { engineOrigin: true }])("preserves protected caller/surface contract: %j", async options => {
  const f = await drive("decision", options);
  if (options.private) expect(f.synthesize).not.toHaveBeenCalled();
  else if (f.synthesize.mock.calls.length) expect(f.synthesize.mock.calls[0][0].answerTableRequest).toBeUndefined();
  expect(f.run.answer).not.toContain(samples.decision.proposal); expect(f.run.answer).not.toContain("Requested table"); expect(f.denied).not.toHaveBeenCalled();
});
