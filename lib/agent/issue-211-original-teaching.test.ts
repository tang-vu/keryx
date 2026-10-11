import { afterEach, expect, it, vi } from "vitest";
import retained from "../../scripts/fixtures/deliverable-teacher-public-c700-e719b085.json";
import { runAgent } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { ProposedEvidence, ReasoningEngine, SynthInput } from "../llm/reasoning-engine";
import { prepareTeachingProposals, reviewTeachingProposals } from "../research/teaching-proposals";
import { parseTeachingProposalRequest } from "../research/teaching-proposals-request";
import { surfaceResearch } from "../research/surface-result";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";

// Only the caller and historical refusal are retained public data. These source
// sentences and transport/review judgments are controlled SYNTHETIC contract
// inputs; they are not an archived NASA body, model review or live useful lesson.
const source = ["Weather describes atmospheric conditions over a short period.",
  "Climate describes average weather over a long period."];
const statements = ["Thời tiết mô tả điều kiện khí quyển trong thời gian ngắn.",
  "Khí hậu mô tả thời tiết trung bình trong thời gian dài."];
const subClaims = ["Theo nguồn gốc, thời tiết được định nghĩa như thế nào?",
  "Theo nguồn gốc, khí hậu được định nghĩa như thế nào và khác thời tiết ra sao?"];
const originalUrl = "https://www.nasa.gov/learning-resources/for-kids-and-students/what-are-climate-and-climate-change-grades-5-8/";
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

async function drive(options: { enabled?: boolean; missing?: "climate" | "all" } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T00:00:00.000Z"));
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", options.enabled === false ? "0" : "1");
  const deniedPayment = vi.fn(async () => { throw new Error("The zero-budget teaching fixture cannot spend"); });
  const attribute = vi.fn(async (input: { used: { sourceId: string }[] }) => input.used.map(row =>
    ({ sourceId: row.sourceId, weight: 1, rationale: "Controlled factual excerpt contribution" })));
  const decompose = vi.fn(async () => subClaims);
  const synthesize = vi.fn(async (input: SynthInput) => {
    const evidence: ProposedEvidence[] = options.missing === "all" ? [] : source.map((quote, claimIndex) => ({
      claimIndex, marker: input.gathered[0].marker, quote, statement: statements[claimIndex],
      support: 0.9, statementSupport: 0.9,
      quoteSpan: { start: source.join(" ").indexOf(quote), end: source.join(" ").indexOf(quote) + quote.length },
    }));
    const proposals = [
      { id: "t1", kind: "activity", text: "Đề xuất: đọc hai định nghĩa trong 2 phút, phân loại thẻ giả định trong 5 phút, giải thích lựa chọn trong 3 phút.", durationMinutes: 10,
        premiseIds: ["e1", "e2"], conditions: ["Không suy xu hướng khí hậu từ tình huống thời tiết một ngày."] },
      { id: "t2", kind: "classification-example", text: "Tình huống giả định: hôm nay có mưa.", answer: "Thời tiết.", premiseIds: ["e1"], conditions: [] },
      { id: "t3", kind: "classification-example", text: "Tình huống giả định: lượng mưa trung bình qua nhiều thập kỷ.", answer: "Khí hậu.", premiseIds: ["e2"], conditions: [] },
      { id: "t4", kind: "exit-question", text: "Theo hai định nghĩa đã đọc, mô tả thời tiết trung bình trong thời gian dài thuộc khái niệm nào?",
        answer: "Khí hậu; không dùng một ngày mưa để suy xu hướng khí hậu.", premiseIds: ["e1", "e2"], conditions: [] },
    ];
    const prepared = input.teachingRequest ? prepareTeachingProposals(input.teachingRequest, input.question, evidence, proposals) : undefined;
    const packet = prepared?.packet;
    const reviewed = packet ? reviewTeachingProposals(packet, { digest: packet.digest, proposals: packet.proposals.map(row => ({
      id: row.id, premiseIds: row.premiseIds, premiseConsistency: "supported", conditions: "supported",
      instructionalConsistency: "supported", sourceAttribution: "supported", requestedScope: "supported", language: "supported",
    })) }) : undefined;
    return { answer: "[S1]", citedMarkers: ["S1"], evidence, evidenceReview: "reviewed" as const,
      ...(prepared ? { teachingProposals: { reviewed, preparationGaps: prepared.gaps } } : {}) };
  });
  const coverage = () => subClaims.map((claim, index) => ({ claim,
    coverage: options.missing === "all" || options.missing === "climate" && index === 1 ? 0 : 0.9, coveredBy: ["S1"] }));
  const engine = { name: "controlled-original-teaching-fixture", decompose,
    decide: async (input: { candidates: { id: string; name: string }[] }) => input.candidates.map(row => ({ sourceId: row.id,
      sourceName: row.name, action: "BUY", expectedValue: 0.9, price: 0, confidence: 0.9,
      rationale: "Controlled read of the exact caller URL", targets: [0, 1] })),
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
  return { run: step.value, attribute, decompose, synthesize, read, deniedPayment, effects };
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
  expect(delivery).toMatchObject({ complete: true, request: { language: "vi", durationMinutes: 10, exampleCount: 2, explanationMaximumWords: 99 } });
  expect(delivery.explanationWords).toBeLessThanOrEqual(99);
  expect(delivery.proposals.map(row => row.proposal.kind)).toEqual(["activity", "classification-example", "classification-example", "exit-question"]);
  expect(delivery.admittedStatements.map(row => row.text)).toEqual(statements);
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
  expect(f.run.answer).toContain("Thiếu kiến thức làm cơ sở:");
  expect(f.run.answer).toContain("tìm đoạn trực tiếp trả lời từng mục");
  expect(f.run.answer).not.toContain("Tình huống giả định: hôm nay có mưa.");
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
