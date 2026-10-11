import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerMarkdown } from "../../components/keryx/answer-markdown";
import retained from "../../scripts/fixtures/deliverable-teacher-public-c700-e719b085.json";
import { runAgent } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { ReasoningEngine, SynthInput } from "../llm/reasoning-engine";
import { JsonChatEngine } from "../llm/json-chat-engine";
import type { TeachingProposalPacket } from "../research/teaching-proposals";
import { parseTeachingProposalRequest } from "../research/teaching-proposals-request";
import { surfaceResearch } from "../research/surface-result";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";

// Only the caller and historical refusal are retained public data. These source
// sentences and transport/review judgments are controlled SYNTHETIC contract
// inputs; they are not an archived NASA body, model review or live useful lesson.
const source = ["Weather describes atmospheric conditions over a short period.",
  "Climate describes average weather over a long period.",
  "A single day's weather does not establish a long-term climate trend."];
const statements = ["Thời tiết mô tả điều kiện khí quyển trong thời gian ngắn.",
  "Khí hậu mô tả thời tiết trung bình trong thời gian dài.",
  "Không thể suy ra xu hướng khí hậu dài hạn từ thời tiết một ngày."];
const subClaims = ["Theo nguồn gốc, thời tiết được định nghĩa như thế nào?",
  "Theo nguồn gốc, khí hậu được định nghĩa như thế nào và khác thời tiết ra sao?",
  "Theo nguồn gốc, vì sao không thể suy xu hướng khí hậu từ thời tiết một ngày?"];
const originalUrl = "https://www.nasa.gov/learning-resources/for-kids-and-students/what-are-climate-and-climate-change-grades-5-8/";
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

class OriginalTeachingEngine extends JsonChatEngine {
  readonly name = "controlled-original-teaching-synthesis";
  packets: { system: string; packet: Record<string, unknown>; cap?: number }[] = [];
  constructor(private readonly options: { missing?: "climate" | "all"; invalidReference?: boolean }) { super(); }
  protected async chatJson(_model: string, system: string, user: string, cap?: number) {
    const packet = JSON.parse(user);
    this.packets.push({ system, packet, cap });
    if (this.packets.length === 1) {
      const quotes = packet.quoteOptions as { quoteId: string; marker: string; text: string }[];
      const evidence = this.options.missing === "all" ? [] : source.map((quote, claimIndex) => {
        const option = quotes.find(row => row.text === quote);
        if (!option) throw new Error("Synthetic factual passage was not selected for generation");
        return { claimIndex, marker: option.marker, quoteId: option.quoteId, statement: statements[claimIndex], support: 0.9 };
      });
      const teachingProposals = [
        { id: "t1", kind: "activity", text: "Đề xuất: đọc các kiến thức đã dẫn nguồn trong 2 phút, phân loại thẻ giả định trong 5 phút, giải thích lựa chọn trong 3 phút.", durationMinutes: 10,
          premiseIds: this.options.invalidReference ? ["e32"] : ["e1", "e2", "e3"], conditions: ["Không suy xu hướng khí hậu từ tình huống thời tiết một ngày."] },
        { id: "t2", kind: "classification-example", text: "Tình huống giả định: hôm nay có mưa.", answer: "Thời tiết.", premiseIds: ["e1"], conditions: [] },
        { id: "t3", kind: "classification-example", text: "Tình huống giả định: lượng mưa trung bình qua nhiều thập kỷ.", answer: "Khí hậu.", premiseIds: ["e2"], conditions: [] },
        { id: "t4", kind: "exit-question", text: "Theo hai định nghĩa đã đọc, mô tả thời tiết trung bình trong thời gian dài thuộc khái niệm nào?",
          answer: "Khí hậu; không dùng một ngày mưa để suy xu hướng khí hậu.", premiseIds: ["e1", "e2", "e3"], conditions: [] },
      ];
      return { evidence, teachingProposals, conflicts: [] };
    }
    const rows = packet.evidence as { index: number }[];
    const candidate = packet.teachingProposals as TeachingProposalPacket | undefined;
    return { reviews: rows.map(row => ({ index: row.index, supportedFact: source[row.index], support: 0.9, statementSupport: 0.9 })),
      ...(candidate ? { teachingProposalReview: { digest: candidate.digest, proposals: candidate.proposals.map(row => ({
        id: row.id, premiseIds: row.premiseIds, premiseConsistency: "supported", conditions: "supported",
        instructionalConsistency: "supported", sourceAttribution: "supported", requestedScope: "supported", language: "supported",
      })) } } : {}) };
  }
}

async function drive(options: { enabled?: boolean; missing?: "climate" | "all"; invalidReference?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T00:00:00.000Z"));
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", options.enabled === false ? "0" : "1");
  const deniedPayment = vi.fn(async () => { throw new Error("The zero-budget teaching fixture cannot spend"); });
  const attribute = vi.fn(async (input: { used: { sourceId: string }[] }) => input.used.map(row =>
    ({ sourceId: row.sourceId, weight: 1, rationale: "Controlled factual excerpt contribution" })));
  const decompose = vi.fn(async () => subClaims);
  const synthesis = new OriginalTeachingEngine(options);
  const synthesize = vi.fn((input: SynthInput) => synthesis.synthesize(input));
  const coverage = () => subClaims.map((claim, index) => ({ claim,
    coverage: options.missing === "all" || options.missing === "climate" && index === 1 ? 0 : 0.9, coveredBy: ["S1"] }));
  const engine = { name: "controlled-original-teaching-fixture", decompose,
    decide: async (input: { candidates: { id: string; name: string }[] }) => input.candidates.map(row => ({ sourceId: row.id,
      sourceName: row.name, action: "BUY", expectedValue: 0.9, price: 0, confidence: 0.9,
      rationale: "Controlled read of the exact caller URL", targets: [0, 1, 2] })),
    sufficiency: async () => ({ sufficient: true, rationale: "Controlled assessment, not NASA semantic verification", perClaim: coverage() }),
    reevaluate: async () => ({ shouldBuyMore: false, recommendedIds: [], rationale: "No extra fixture reads" }), synthesize, attribute,
  } as unknown as ReasoningEngine;
  const effects: ResearchEffects = { scope: { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: deniedPayment,
    saveQueryRun: vi.fn(async () => {}), saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const read = vi.fn(async (url: string) => ({ finalUrl: url, text: source.join(" "),
    title: "Controlled synthetic classroom premises; not a retained NASA body", kind: "text" as const, truncated: false }));
  const deps: AgentDeps = { db: { listSources: async () => [], listPublicReferences: async () => [] } as unknown as KeryxDB,
    engine, effects, readWebArticle: read, webSearch: { search: vi.fn(async () => []) } as unknown as AgentDeps["webSearch"],
    gateway: { mode: "real", agentAddress: () => "0x0000000000000000000000000000000000000001",
      ensureFunded: deniedPayment, payFetch: deniedPayment, payCitation: deniedPayment } as unknown as PaymentGateway };
  const iterator = runAgent({ queryId: "original-teacher-controlled", question: retained.question, origin: "web", budget: 0, researchMode: "quick" }, deps);
  let step = await iterator.next(); while (!step.done) step = await iterator.next();
  return { run: step.value, attribute, decompose, synthesize, synthesis, read, deniedPayment, effects };
}

it("binds the exact retained Vietnamese caller and delivers its opt-in contract with explicitly synthetic premises", async () => {
  expect(retained.bindings).toEqual([]); // The historical refusal cannot supply positive NASA evidence.
  expect(retained.provenance.reportUrl).toContain("e719b085-2528-4fd9-9dfb-7cb60cdf50c4");
  const f = await drive(), delivery = f.run.teachingProposals!;
  expect(f.decompose).toHaveBeenCalledWith(retained.question);
  expect(f.read).toHaveBeenCalledOnce();
  expect(f.read.mock.calls[0][0]).toBe(originalUrl);
  expect(f.synthesize).toHaveBeenCalledOnce();
  expect(f.synthesize.mock.calls[0][0].teachingRequest).toEqual(parseTeachingProposalRequest(retained.question));
  expect(f.synthesis.packets).toHaveLength(2);
  expect(f.synthesis.packets.map(row => row.cap)).toEqual([2304, 1792]);
  expect(f.synthesis.packets[0].packet.question).toBe(retained.question);
  expect(f.synthesis.packets[0].system).toContain("Write factual statements in Vietnamese");
  const packet = f.synthesis.packets[1].packet.teachingProposals as TeachingProposalPacket;
  expect(packet.originalQuestion).toBe(retained.question);
  expect(packet.premises.map(row => row.statement.quote)).toEqual(source);
  expect(delivery).toMatchObject({ complete: true, request: { language: "vi", durationMinutes: 10, exampleCount: 2, explanationMaximumWords: 99 } });
  expect(delivery.explanationWords).toBeLessThanOrEqual(99);
  expect(delivery.proposals.map(row => row.proposal.kind)).toEqual(["activity", "classification-example", "classification-example", "exit-question"]);
  expect(delivery.admittedStatements.map(row => row.text)).toEqual(statements);
  for (const quote of source) expect(f.run.answer).toContain(quote);
  expect(f.run.answer).toContain("Hoạt động do Keryx đề xuất (10 phút)");
  expect(f.run.answer).toContain("Tình huống giả định: hôm nay có mưa.");
  expect(f.run.answer).toContain("Không suy xu hướng khí hậu từ tình huống thời tiết một ngày.");
  expect(f.run.answer).not.toContain("NASA đã thực nghiệm");
  expect(f.run.totalSpent).toBe(0); expect(f.deniedPayment).not.toHaveBeenCalled();
  const receipt = buildResearchReceipt(f.run, []);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.teachingProposals).toEqual(delivery);
  expect(surfaceResearch(f.run).teachingProposals).toEqual(delivery);
  expect(researchReportMarkdown(f.run, null, [])).toContain("Hoạt động do Keryx đề xuất (10 phút)");
  const html = renderToStaticMarkup(createElement(AnswerMarkdown, { text: f.run.answer, citations: f.run.citations }));
  for (const statement of statements) expect(html).toContain(statement);
  expect(html).toContain("Hoạt động do Keryx đề xuất (10 phút)");
  expect(html.match(/Ví dụ phân loại do Keryx đề xuất/gu)).toHaveLength(2);
  expect(html).toContain("Câu hỏi cuối giờ do Keryx đề xuất");
  expect(html.match(/Đáp án:/gu)).toHaveLength(3);
});

it("identifies missing final factual support and gives an original-source next step while keeping an independent useful sibling", async () => {
  const f = await drive({ missing: "climate" });
  expect(f.run.teachingProposals).toMatchObject({ complete: false });
  expect(f.run.teachingProposals!.proposals.map(row => row.proposal.id)).toEqual(["t2"]);
  expect(f.run.answer).toContain("Thiếu kiến thức làm cơ sở:");
  expect(f.run.answer).toContain("các mục kiến thức còn thiếu ở phần trả lời trên với nguồn gốc bạn đã yêu cầu");
  expect(f.run.answer).toContain("tình huống giả định không thay thế bằng chứng");
  expect(f.run.answer).toContain(subClaims[1]);
  // The separately admitted statement remains visible with its partial-coverage
  // gap; insufficient final coverage withholds its dependent proposal, not facts.
  expect(f.run.answer).toContain(statements[1]);
  expect(f.run.answer).toContain("vẫn dưới ngưỡng hỗ trợ");
  expect(f.run.answer).not.toContain("lượng mưa trung bình qua nhiều thập kỷ");
  expect(f.run.answer).toContain("Tình huống giả định: hôm nay có mưa.");
  expect(f.synthesize).toHaveBeenCalledOnce(); expect(f.read).toHaveBeenCalledOnce(); expect(f.deniedPayment).not.toHaveBeenCalled();
});

it("does not invent NASA evidence or a lesson when all factual premises are unavailable", async () => {
  const f = await drive({ missing: "all" });
  expect(f.run.teachingProposals!.proposals).toEqual([]);
  expect(f.run.teachingProposals!.complete).toBe(false);
  expect(f.run.evidence).toEqual([]); expect(f.run.citations).toEqual([]);
  expect(f.run.answer).toContain("Liên kết kiến thức của đề xuất còn thiếu:");
  expect(f.run.answer).toContain("tìm đoạn trực tiếp trả lời mục đó");
  expect(f.run.answer).not.toContain("Tình huống giả định: hôm nay có mưa.");
  expect(f.deniedPayment).not.toHaveBeenCalled();
});

it("keeps supported facts and examples when a draft uses an invalid premise reference", async () => {
  const f = await drive({ invalidReference: true });
  expect(f.run.teachingProposals!.complete).toBe(false);
  expect(f.run.teachingProposals!.proposals.map(row => row.proposal.id)).toEqual(["t2", "t3", "t4"]);
  expect(f.run.teachingProposals!.admittedStatements.map(row => row.text)).toEqual(statements);
  expect(f.run.answer).toContain("tham chiếu kiến thức không khớp với câu đã dẫn nguồn");
  expect(f.run.answer).not.toContain("bằng chứng cuối cùng chưa đủ");
  expect(f.synthesis.packets).toHaveLength(2);
  expect(f.read).toHaveBeenCalledOnce();
  expect(f.deniedPayment).not.toHaveBeenCalled();
});

it("keeps the exact original default-off path and financial attribution unchanged", async () => {
  const off = await drive({ enabled: false }), on = await drive();
  expect(off.run).not.toHaveProperty("teachingProposals");
  expect(off.synthesize.mock.calls[0][0]).not.toHaveProperty("teachingRequest");
  expect(off.attribute.mock.calls[0][0]).toEqual(on.attribute.mock.calls[0][0]);
  expect(off.run.evidence).toEqual(on.run.evidence);
  expect(off.run.claimCoverage).toEqual(on.run.claimCoverage);
  expect(off.run.citations).toEqual(on.run.citations);
  expect(off.run.totalSpent).toBe(on.run.totalSpent);
  expect(off.run.totalToCreators).toBe(on.run.totalToCreators);
  expect(off.deniedPayment).not.toHaveBeenCalled(); expect(on.deniedPayment).not.toHaveBeenCalled();
});
