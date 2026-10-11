import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerMarkdown } from "../../components/keryx/answer-markdown";
import retained from "../../scripts/fixtures/deliverable-teacher-public-c700-e719b085.json";
import snapshot from "./fixtures/nasa-weather-climate-fresh-20261011.json";
import { runAgent } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { ReasoningEngine, SynthInput } from "../llm/reasoning-engine";
import { JsonChatEngine } from "../llm/json-chat-engine";
import { extractHtml } from "../web-research/html-reader";
import { gatheredArticle, type ArticleRead } from "../web-research/article-reader";
import type { TeachingProposalPacket } from "../research/teaching-proposals";
import { parseTeachingProposalRequest } from "../research/teaching-proposals-request";
import { surfaceResearch } from "../research/surface-result";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";

// Source bytes are a fresh official NASA snapshot. Every supplier response,
// paraphrase, coverage estimate and review judgment below is SYNTHETIC. This
// exercises real extraction/admission, not live semantic review or activation.
const quotes = [
  "Weather is the short-term changes we see in temperature, clouds, precipitation, humidity and wind in a region or a city.",
  "The climate of a region or city is its weather averaged over many years.",
  "Weather can vary greatly from one day to the next, or even within the same day.",
];
const statements = [
  "Thời tiết là những thay đổi ngắn hạn về nhiệt độ, mây, mưa, độ ẩm và gió ở một vùng hoặc thành phố.",
  "Khí hậu của một vùng hoặc thành phố là thời tiết trung bình qua nhiều năm.",
  "Thời tiết có thể thay đổi từ ngày này sang ngày khác, ngay cả trong cùng một ngày.",
];
// Controlled source-language factual targets, not observed live decomposition.
// The exact Vietnamese original caller still controls language and lesson scope.
const targets = ["What are the short-term changes in temperature, clouds, precipitation, humidity and wind?",
  "How is the climate of a region or city defined by weather averaged over many years?",
  "How can weather vary from one day to the next or within the same day?"];
const untranslatedTargets = ["Theo NASA, thời tiết (weather) là gì?", "Theo NASA, khí hậu (climate) là gì?",
  "Theo NASA, thời tiết có thể thay đổi trong phạm vi một ngày như thế nào?"];
let article: ArticleRead;
beforeAll(async () => {
  const gzip = await readFile("lib/agent/fixtures/nasa-weather-climate-fresh-20261011.html.gz");
  expect(gzip.length).toBe(snapshot.gzipBytes);
  expect(createHash("sha256").update(gzip).digest("hex")).toBe(snapshot.gzipSha256);
  const html = gunzipSync(gzip);
  expect(html.length).toBe(snapshot.rawBytes);
  expect(createHash("sha256").update(html).digest("hex")).toBe(snapshot.rawSha256);
  article = await extractHtml(html.toString("utf8"), snapshot.finalUrl);
  const gathered = gatheredArticle("public:web:nasa-weather-climate", article);
  expect(article.text.length).toBe(snapshot.extractedTextLength);
  expect(article.truncated).toBe(false);
  expect(gathered.contentVersion).toBe(snapshot.contentVersion);
  expect(gathered.webProvenance?.normalizedBodyHash).toBe(snapshot.normalizedBodyHash);
  for (const quote of quotes) expect(article.text).toContain(quote);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

type Failure = "none" | "climate-withheld" | "review-unavailable" | "false-source-attribution" | "unselected-facts";
class SyntheticNasaTeachingTransport extends JsonChatEngine {
  readonly name = "llm:synthetic-nasa-teaching-fixture";
  packets: { system: string; packet: Record<string, unknown>; cap?: number }[] = [];
  constructor(private readonly failure: Failure) { super(); }
  protected async chatJson(_model: string, system: string, user: string, cap?: number) {
    const packet = JSON.parse(user);
    this.packets.push({ system, packet, cap });
    if (this.packets.length === 1) {
      const options = packet.quoteOptions as { quoteId: string; marker: string; text: string }[];
      const evidence = quotes.flatMap((quote, claimIndex) => {
        const option = options.find(row => row.text === quote);
        if (!option && this.failure === "unselected-facts") return [];
        if (!option) throw new Error("Actual NASA passage was not selected for generation");
        return [{ claimIndex, marker: option.marker, quoteId: option.quoteId, statement: statements[claimIndex], support: 0.9 }];
      });
      return { evidence, conflicts: [], teachingProposals: [
        { id: "t1", kind: "activity", text: this.failure === "false-source-attribution" ? "NASA đã thực nghiệm hoạt động này trong lớp học." :
          "Đề xuất: đọc kiến thức đã dẫn nguồn trong 2 phút; theo cặp phân loại hai thẻ giả định trong 5 phút; giải thích lựa chọn và trả lời câu hỏi cuối giờ trong 3 phút.",
          durationMinutes: 10, premiseIds: ["e1", "e2", "e3"], conditions: ["Không dùng thời tiết một ngày để suy ra xu hướng khí hậu."] },
        { id: "t2", kind: "classification-example", text: "Tình huống giả định do Keryx đề xuất: hôm nay thành phố có mưa.", answer: "Thời tiết, vì mô tả một ngày.", premiseIds: ["e1", "e3"], conditions: [] },
        { id: "t3", kind: "classification-example", text: "Tình huống giả định do Keryx đề xuất: nhiệt độ trung bình của thành phố qua nhiều năm.", answer: "Khí hậu, vì mô tả trung bình nhiều năm.", premiseIds: ["e2"], conditions: [] },
        { id: "t4", kind: "exit-question", text: "Một buổi sáng lạnh có đủ để kết luận khí hậu của thành phố đang lạnh đi không?",
          answer: "Không. Thời tiết có thể đổi trong ngày; khí hậu xét trung bình nhiều năm, không suy xu hướng từ một ngày.", premiseIds: ["e1", "e2", "e3"], conditions: [] },
      ] };
    }
    expect(this.packets).toHaveLength(2);
    if (this.failure === "review-unavailable") throw new Error("Synthetic independent review unavailable");
    const rows = packet.evidence as { index: number; source: { webProvenance: { normalizedBodyHash: string } } }[];
    for (const row of rows) expect(row.source.webProvenance.normalizedBodyHash).toBe(snapshot.normalizedBodyHash);
    const proposals = packet.teachingProposals as TeachingProposalPacket | undefined;
    return { reviews: rows.map(row => ({ index: row.index, supportedFact: "Synthetic review of an actual NASA excerpt", support: 0.9, statementSupport: 0.9 })),
      ...(proposals ? { teachingProposalReview: { digest: proposals.digest, proposals: proposals.proposals.map(row => ({
        id: row.id, premiseIds: row.premiseIds, premiseConsistency: "supported", conditions: "supported", instructionalConsistency: "supported",
        sourceAttribution: this.failure === "false-source-attribution" && row.id === "t1" ? "unsupported" : "supported", requestedScope: "supported", language: "supported",
      })) } } : {}) };
  }
}

async function drive(options: { enabled?: boolean; failure?: Failure; untranslated?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(snapshot.capturedAtUtc));
  if (options.enabled === false) vi.stubEnv("KERYX_TEACHING_PROPOSALS", undefined);
  else vi.stubEnv("KERYX_TEACHING_PROPOSALS", "1");
  const failure = options.failure ?? "none";
  const deniedPayment = vi.fn(async () => { throw new Error("The exact zero-budget NASA lesson cannot spend"); });
  const transport = new SyntheticNasaTeachingTransport(failure);
  const synthesize = vi.fn((input: SynthInput) => transport.synthesize(input));
  const attribute = vi.fn(async (input: { used: { sourceId: string }[] }) => input.used.map(row => ({ sourceId: row.sourceId, weight: 1, rationale: "Synthetic factual contribution assessment" })));
  const activeTargets = failure === "unselected-facts" ? untranslatedTargets.map(target => target.replace(/\s*\([^)]*\)/gu, ""))
    : options.untranslated ? untranslatedTargets : targets;
  const engine = { name: "synthetic-nasa-teaching-engine", decompose: async () => activeTargets,
    decide: async (input: { candidates: { id: string; name: string }[] }) => input.candidates.map(row => ({ sourceId: row.id, sourceName: row.name,
      action: "BUY", expectedValue: 0.9, price: 0, confidence: 0.9, rationale: "Controlled selection of the exact free NASA original", targets: [0, 1, 2] })),
    sufficiency: async () => ({ sufficient: true, rationale: "Synthetic assessment", perClaim: activeTargets.map((claim, index) => ({ claim,
      coverage: failure === "climate-withheld" && index === 1 ? 0 : 0.9, coveredBy: ["S1"] })) }),
    reevaluate: async () => ({ shouldBuyMore: false, recommendedIds: [], rationale: "No further reads" }), synthesize, attribute } as unknown as ReasoningEngine;
  const effects: ResearchEffects = { scope: { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: deniedPayment,
    saveQueryRun: vi.fn(async () => {}), saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const read = vi.fn(async (_url: string, _signal?: AbortSignal) => article), search = vi.fn(async () => []);
  const deps: AgentDeps = { db: { listSources: async () => [], listPublicReferences: async () => [] } as unknown as KeryxDB,
    engine, effects, readWebArticle: read, webSearch: { search } as unknown as AgentDeps["webSearch"],
    gateway: { mode: "real", agentAddress: () => "0x0000000000000000000000000000000000000001", ensureFunded: deniedPayment,
      payFetch: deniedPayment, payCitation: deniedPayment } as unknown as PaymentGateway };
  const iterator = runAgent({ queryId: "fresh-nasa-original-teacher", question: retained.question, origin: "web", budget: 0, researchMode: "quick" }, deps);
  let row = await iterator.next(); while (!row.done) row = await iterator.next();
  return { run: row.value, transport, synthesize, attribute, read, search, deniedPayment };
}

it("delivers the exact original Vietnamese lesson contract from actual fresh NASA passages with synthetic supplier responses", async () => {
  expect(retained.bindings).toEqual([]);
  expect(parseTeachingProposalRequest(retained.question)).toMatchObject({ language: "vi", durationMinutes: 10, exampleCount: 2, explanationMaximumWords: 99 });
  const f = await drive(), delivery = f.run.teachingProposals!;
  expect(f.read).toHaveBeenCalledOnce(); expect(f.read.mock.calls[0][0]).toBe(snapshot.requestUrl);
  expect(f.synthesize).toHaveBeenCalledOnce(); expect(f.transport.packets).toHaveLength(2);
  expect(f.transport.packets.map(row => row.cap)).toEqual([2304, 1792]);
  expect(f.transport.packets[0].packet.question).toBe(retained.question);
  expect(delivery.complete).toBe(true); expect(delivery.explanationWords).toBeLessThan(100);
  expect(delivery.admittedStatements.map(row => row.text)).toEqual(statements);
  expect(delivery.proposals.map(row => row.proposal.kind)).toEqual(["activity", "classification-example", "classification-example", "exit-question"]);
  for (const quote of quotes) expect(f.run.answer).toContain(quote);
  expect(f.run.answer).toContain("Hoạt động do Keryx đề xuất (10 phút)");
  expect(f.run.answer).toContain("Không dùng thời tiết một ngày để suy ra xu hướng khí hậu.");
  expect(f.run.answer).not.toContain("NASA đã thực nghiệm");
  const html = renderToStaticMarkup(createElement(AnswerMarkdown, { text: f.run.answer, citations: f.run.citations }));
  expect(html.match(/Ví dụ phân loại do Keryx đề xuất/gu)).toHaveLength(2);
  expect(html).toContain("Câu hỏi cuối giờ do Keryx đề xuất"); expect(html.match(/Đáp án:/gu)).toHaveLength(3);
  expect(f.run.citations).toHaveLength(1); expect(f.run.citations[0].reward).toBe(0);
  expect(f.run.totalSpent).toBe(0); expect(f.deniedPayment).not.toHaveBeenCalled();
  expect(f.search).toHaveBeenCalledTimes(2); // Controlled empty transport, never a live search.
  expect(f.attribute.mock.calls[0][0]).not.toHaveProperty("teachingProposals");
  expect(surfaceResearch(f.run).teachingProposals).toEqual(delivery);
  const receipt = buildResearchReceipt(f.run, []); expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.teachingProposals).toEqual(delivery);
  expect(researchReportMarkdown(f.run, null, [])).toContain("Hoạt động do Keryx đề xuất (10 phút)");
});

it("withholds climate-dependent lesson parts after final support fails and gives a targeted original-source next step", async () => {
  const f = await drive({ failure: "climate-withheld", untranslated: true });
  expect(f.run.teachingProposals!.complete).toBe(false);
  expect(f.run.teachingProposals!.proposals.map(row => row.proposal.id)).toEqual(["t2"]);
  expect(f.run.answer).toContain("Thiếu kiến thức làm cơ sở:");
  expect(f.run.answer).toContain("nguồn gốc bạn đã yêu cầu");
  expect(f.run.answer).toContain("hôm nay thành phố có mưa");
  expect(f.run.answer).not.toContain("nhiệt độ trung bình của thành phố qua nhiều năm");
  expect(f.read).toHaveBeenCalledOnce(); expect(f.synthesize).toHaveBeenCalledOnce(); expect(f.deniedPayment).not.toHaveBeenCalled();
});

it("admits the original Vietnamese targets through their explicit glosses and actual NASA heading without changing factual or financial gates", async () => {
  const off = await drive({ enabled: false, untranslated: true }), on = await drive({ untranslated: true });
  const packet = on.transport.packets[0].packet;
  expect(packet.question).toBe(retained.question);
  expect(packet.researchTargets).toEqual(untranslatedTargets.map((question, claimIndex) => ({ question, claimIndex })));
  const options = packet.quoteOptions as { text: string }[];
  for (const quote of quotes) expect(options.map(row => row.text)).toContain(quote);
  expect(on.run.teachingProposals!.complete).toBe(true);
  expect(on.run.teachingProposals!.admittedStatements.map(row => row.text)).toEqual(statements);
  expect(on.run.teachingProposals!.explanationWords).toBe(57);
  expect(on.run.teachingProposals!.proposals.map(row => row.proposal.kind)).toEqual(["activity", "classification-example", "classification-example", "exit-question"]);
  expect(on.transport.packets.map(row => row.cap)).toEqual([2304, 1792]);
  expect(on.read).toHaveBeenCalledOnce(); expect(on.search).toHaveBeenCalledTimes(2);
  expect(off.run).not.toHaveProperty("teachingProposals");
  expect(off.run.evidence).toEqual(on.run.evidence); expect(off.run.claimCoverage).toEqual(on.run.claimCoverage);
  expect(off.run.citations).toEqual(on.run.citations); expect(off.attribute.mock.calls[0][0]).toEqual(on.attribute.mock.calls[0][0]);
  expect(off.run.totalSpent).toBe(0); expect(on.run.totalSpent).toBe(0);
  expect(off.deniedPayment).not.toHaveBeenCalled(); expect(on.deniedPayment).not.toHaveBeenCalled();
  const html = renderToStaticMarkup(createElement(AnswerMarkdown, { text: on.run.answer, citations: on.run.citations }));
  expect(html.match(/Ví dụ phân loại do Keryx đề xuất/gu)).toHaveLength(2);
  expect(html).toContain("Câu hỏi cuối giờ do Keryx đề xuất");
  expect(on.run.answer).toContain("Không dùng thời tiết một ngày để suy ra xu hướng khí hậu.");
  expect(on.run.answer).not.toContain("NASA đã thực nghiệm");
  expect(surfaceResearch(on.run).teachingProposals).toEqual(on.run.teachingProposals);
  const receipt = buildResearchReceipt(on.run, []); expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.teachingProposals).toEqual(on.run.teachingProposals);
  expect(researchReportMarkdown(on.run, null, [])).toContain("Hoạt động do Keryx đề xuất (10 phút)");
});

it("records an unglossed-target retrieval limitation without pretending the available NASA facts or invented lesson were admitted", async () => {
  const f = await drive({ failure: "unselected-facts" });
  const options = f.transport.packets[0].packet.quoteOptions as { text: string }[];
  for (const quote of quotes) {
    expect(article.text).toContain(quote);
    expect(options.map(row => row.text)).not.toContain(quote);
  }
  expect(f.run.teachingProposals!.complete).toBe(false);
  expect(f.run.teachingProposals!.proposals).toEqual([]);
  expect(f.run.answer).toContain("tìm đoạn trực tiếp trả lời mục đó");
  expect(f.run.answer).not.toContain("hôm nay thành phố có mưa");
  expect(f.transport.packets).toHaveLength(1); // No proposal-only review or repair.
  expect(f.read).toHaveBeenCalledOnce(); expect(f.deniedPayment).not.toHaveBeenCalled();
});

it("withholds false NASA-performed attribution while preserving separately reviewed examples", async () => {
  const f = await drive({ failure: "false-source-attribution", untranslated: true });
  expect(f.run.teachingProposals!.complete).toBe(false);
  expect(f.run.teachingProposals!.proposals.map(row => row.proposal.id)).toEqual(["t2", "t3", "t4"]);
  expect(f.run.answer).not.toContain("NASA đã thực nghiệm"); expect(f.deniedPayment).not.toHaveBeenCalled();
});

it("does not manufacture a NASA lesson or make another call when independent review is unavailable", async () => {
  const f = await drive({ failure: "review-unavailable", untranslated: true });
  expect(f.run.teachingProposals!.complete).toBe(false); expect(f.run.teachingProposals!.proposals).toEqual([]);
  expect(f.run.answer).not.toContain("hôm nay thành phố có mưa"); expect(f.transport.packets).toHaveLength(2);
  expect(f.read).toHaveBeenCalledOnce(); expect(f.deniedPayment).not.toHaveBeenCalled();
});

it("preserves absent-flag original admission and factual/financial output on the actual NASA snapshot", async () => {
  const off = await drive({ enabled: false }), on = await drive();
  expect(off.run).not.toHaveProperty("teachingProposals"); expect(off.synthesize.mock.calls[0][0]).not.toHaveProperty("teachingRequest");
  expect(off.run.evidence).toEqual(on.run.evidence); expect(off.run.claimCoverage).toEqual(on.run.claimCoverage);
  expect(off.run.citations).toEqual(on.run.citations); expect(off.attribute.mock.calls[0][0]).toEqual(on.attribute.mock.calls[0][0]);
  expect(off.run.totalSpent).toBe(on.run.totalSpent); expect(off.run.totalToCreators).toBe(on.run.totalToCreators);
  expect(off.deniedPayment).not.toHaveBeenCalled(); expect(on.deniedPayment).not.toHaveBeenCalled();
});
