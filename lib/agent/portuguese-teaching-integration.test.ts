import { afterEach, expect, it, vi } from "vitest";
import { runAgent, type RunInput } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { ReasoningEngine, SynthInput } from "../llm/reasoning-engine";
import { JsonChatEngine } from "../llm/json-chat-engine";
import * as portugueseIntent from "../research/portuguese-teaching-request";
import type { TeachingProposalPacket } from "../research/teaching-proposals";
import { teachingProposalAnswer } from "../research/teaching-proposals-presentation";
import { projectTeachingProposalDelivery } from "../research/teaching-proposals-surface";
import { surfaceResearch } from "../research/surface-result";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";

// The original Portuguese caller is observed. All premises, proposals, judgments,
// planning and reads below are synthetic; this does not certify a live lesson.
const question = "Sou professora de ciências no Brasil e preciso de uma atividade de dez minutos. Leia https://climatekids.nasa.gov/weather-climate, incluindo o texto da transcrição. Responda em português: explique tempo e clima em menos de 100 palavras; proponha dois exemplos para os alunos classificarem; termine com uma pergunta e sua resposta. Cite a NASA para os conhecimentos e marque os exemplos e a atividade como propostas suas, sem dizer que a NASA realizou essa aula. Não deduza uma tendência climática do tempo de um único dia.";
const facts = ["Weather describes atmospheric conditions over a short period.", "Climate describes average weather over a long period."];
const statements = ["O tempo descreve as condições atmosféricas durante um período curto.", "O clima descreve as condições meteorológicas médias ao longo de um período prolongado."];
const targets = ["What is weather?", "What is climate?"];
type Failure = "missing-climate" | "no-review" | "wrong-language" | "source-performed" | "invalid-premise";

class Transport extends JsonChatEngine {
  readonly name = "synthetic-portuguese-teaching";
  packets: { system: string; packet: Record<string, unknown>; cap?: number }[] = [];
  constructor(private failure?: Failure) { super(); }
  protected async chatJson(_model: string, system: string, user: string, cap?: number) {
    const packet = JSON.parse(user); this.packets.push({ system, packet, cap });
    if (this.packets.length === 1) {
      const options = packet.quoteOptions as { quoteId: string; marker: string; text: string }[];
      return { evidence: facts.map((fact, claimIndex) => {
        const option = options.find(row => row.text === fact)!;
        return { claimIndex, marker: option.marker, quoteId: option.quoteId, statement: statements[claimIndex], support: 0.9 };
      }), conflicts: [], teachingProposals: [
        { id: "t1", kind: "activity", text: this.failure === "source-performed" ? "A NASA realizou esta aula." : "Proposta: classifique cartões inventados sobre condições de curto e longo prazo.",
          durationMinutes: 10, premiseIds: this.failure === "invalid-premise" ? ["e32"] : ["e1", "e2"], conditions: ["Não deduza uma tendência climática de um único dia."] },
        { id: "t2", kind: "classification-example", text: "Situação inventada: hoje está chovendo.", answer: "Tempo.", premiseIds: ["e1"], conditions: [] },
        { id: "t3", kind: "classification-example", text: "Situação inventada: média de chuva durante várias décadas.", answer: "Clima.", premiseIds: ["e2"], conditions: [] },
        { id: "t4", kind: "exit-question", text: "Qual conceito descreve a média das condições meteorológicas ao longo de muitos anos?", answer: "Clima.", premiseIds: ["e2"], conditions: [] },
      ] };
    }
    const candidate = packet.teachingProposals as TeachingProposalPacket | undefined;
    return { reviews: (packet.evidence as { index: number }[]).map(row => ({ index: row.index,
      supportedFact: facts[row.index], support: 0.9, statementSupport: 0.9, statementLanguage: "pt" })),
      ...(candidate && this.failure !== "no-review" ? { teachingProposalReview: { digest: candidate.digest,
        proposals: candidate.proposals.map(row => ({ id: row.id, premiseIds: row.premiseIds,
          premiseConsistency: "supported", conditions: "supported", instructionalConsistency: "supported", requestedScope: "supported",
          sourceAttribution: this.failure === "source-performed" && row.id === "t1" ? "unsupported" : "supported",
          language: this.failure === "wrong-language" && row.id === "t2" ? "unsupported" : "supported" })) } } : {}) };
  }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function drive(options: { baseline?: boolean; failure?: Failure; disabled?: boolean; input?: Partial<RunInput>; private?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", options.disabled ? "0" : "1");
  const selector = options.baseline ? vi.spyOn(portugueseIntent, "portugueseTeachingRequest").mockReturnValue(undefined) : undefined;
  const transport = new Transport(options.failure);
  const synthesize = vi.fn((input: SynthInput) => transport.synthesize(input));
  const attribute = vi.fn(async (input: { used: { sourceId: string }[] }) => input.used.map(row => ({ sourceId: row.sourceId, weight: 1, rationale: "Controlled factual contribution" })));
  const denied = vi.fn(async () => { throw new Error("Synthetic Portuguese lesson cannot use the network or move money"); });
  vi.stubGlobal("fetch", denied);
  const engine = { name: "synthetic-portuguese-agent", decompose: vi.fn(async () => targets),
    decide: async (input: { candidates: { id: string; name: string }[] }) => input.candidates.map(row => ({ sourceId: row.id, sourceName: row.name,
      action: "BUY", price: 0, expectedValue: 0.9, confidence: 0.9, targets: [0, 1], rationale: "Controlled free original read" })),
    sufficiency: async () => ({ sufficient: true, rationale: "Synthetic assessment", perClaim: targets.map((claim, index) => ({ claim,
      coverage: options.failure === "missing-climate" && index === 1 ? 0 : 0.9, coveredBy: ["S1"] })) }),
    reevaluate: async () => ({ shouldBuyMore: false, recommendedIds: [], rationale: "No extra fixture reads" }), synthesize, attribute } as unknown as ReasoningEngine;
  const queryId = options.private ? "prv_portuguese_teaching" : "portuguese-teaching";
  const effects: ResearchEffects = { scope: options.private ? { kind: "job", queryId } : { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: denied,
    saveQueryRun: vi.fn(async () => {}), saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const readMetadata: unknown[] = [];
  const read = vi.fn(async (finalUrl: string, signal?: AbortSignal, readOptions?: Parameters<NonNullable<AgentDeps["readWebArticle"]>>[2]) => {
    readMetadata.push({ url: finalUrl, cancellationSignal: signal instanceof AbortSignal, abortedAtDispatch: signal?.aborted, options: readOptions });
    return { finalUrl, text: facts.join(" "), title: "Synthetic classroom premises, not an observed NASA body", kind: "text" as const, truncated: false };
  });
  const searchMetadata: unknown[] = [];
  const search = vi.fn(async (query: string, signal?: AbortSignal) => {
    searchMetadata.push({ query, cancellationSignal: signal instanceof AbortSignal, abortedAtDispatch: signal?.aborted });
    return [];
  });
  const deps: AgentDeps = { engine, effects, readWebArticle: read, webSearch: { search },
    db: { listSources: async () => [], listPublicReferences: async () => [] } as unknown as KeryxDB,
    gateway: { mode: "real", agentAddress: () => "0x0000000000000000000000000000000000000001", ensureFunded: denied, payFetch: denied, payCitation: denied } as unknown as PaymentGateway };
  try {
    const iterator = runAgent({ queryId, question, origin: "web", budget: 0, researchMode: "quick", ...options.input }, deps);
    let step = await iterator.next(); while (!step.done) step = await iterator.next();
    return { run: step.value, transport, synthesize, attribute, denied, read, readMetadata, search, searchMetadata, effects };
  } finally { selector?.mockRestore(); }
}

it("adds reviewed Portuguese proposals after identical factual admission and monetary attribution", async () => {
  const before = await drive({ baseline: true }), after = await drive();
  expect(before.run.question).toBe(question); expect(after.run.question).toBe(question);
  expect(after.run.teachingProposals).toMatchObject({ complete: true, request: { language: "pt", durationMinutes: 10, exampleCount: 2, explanationMaximumWords: 99 } });
  expect(before.run.teachingProposals).toBeUndefined();
  expect(after.transport.packets).toHaveLength(2); expect(before.transport.packets).toHaveLength(2);
  expect(after.transport.packets[0].system).toContain("in Portuguese");
  expect(after.transport.packets[0].system).not.toContain("in English");
  // Existing cap calculation for two factual rows plus four proposals.
  expect(after.transport.packets.map(row => row.cap)).toEqual([2304, 1536]);
  for (const key of ["question", "subClaims", "quoteOptions", "sources"])
    expect(after.transport.packets[0].packet[key]).toEqual(before.transport.packets[0].packet[key]);
  expect(after.attribute.mock.calls).toEqual(before.attribute.mock.calls);
  for (const key of ["evidence", "citations", "claimCoverage", "decisions", "totalSpent", "totalToCreators"] as const)
    expect(after.run[key]).toEqual(before.run[key]);
  expect(after.readMetadata).toEqual(before.readMetadata); expect(after.searchMetadata).toEqual(before.searchMetadata);
  expect(after.read).toHaveBeenCalledOnce(); expect(after.synthesize).toHaveBeenCalledOnce(); expect(after.denied).not.toHaveBeenCalled();
  expect(after.run.answer).toContain("Propostas de ensino");
  expect(after.run.answer).toContain("Atividade de sala de aula proposta pelo Keryx (10 minutos)");
  expect(after.run.answer).toContain("Condição: Não deduza"); expect(after.run.answer).toContain("Resposta: Clima.");
  expect(after.run.teachingProposals!.proposals.map(row => row.proposal.kind)).toEqual(["activity", "classification-example", "classification-example", "exit-question"]);
  expect(surfaceResearch(after.run).teachingProposals).toEqual(after.run.teachingProposals);
  const receipt = buildResearchReceipt(after.run, []); expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.teachingProposals).toEqual(after.run.teachingProposals);
  expect(researchReportMarkdown(after.run, null, [])).toContain("Atividade de sala de aula proposta pelo Keryx");
});

it.each(["missing-climate", "no-review", "wrong-language", "source-performed", "invalid-premise"] as const)(
  "keeps the original failure/factual gates for Portuguese proposals: %s", async failure => {
    const f = await drive({ failure }), delivered = f.run.teachingProposals!;
    expect(delivered.complete).toBe(false); expect(f.transport.packets).toHaveLength(2); expect(f.denied).not.toHaveBeenCalled();
    if (failure === "missing-climate") {
      expect(delivered.proposals.map(row => row.proposal.id)).toEqual(["t2"]);
      expect(f.run.answer).toContain("Falta uma premissa factual");
    }
    if (failure === "no-review") expect(delivered.proposals).toEqual([]);
    if (failure === "wrong-language") expect(delivered.proposals.map(row => row.proposal.id)).not.toContain("t2");
    if (failure === "source-performed") expect(f.run.answer).not.toContain("A NASA realizou esta aula");
    if (failure === "invalid-premise") expect(f.run.answer).toContain("Falta uma referência de premissa");
  });

it.each([
  { name: "flag disabled", disabled: true, synthesisCount: 1 },
  { name: "private job", private: true, synthesisCount: 0 },
  { name: "augmented context", input: { question: question + "\nPrior context", originalQuestion: question }, synthesisCount: 1 },
  { name: "bounded package", input: { executionLimits: { attentionLimit: 1, reevaluateRounds: 0 } }, synthesisCount: 1 },
  { name: "decision brief", input: { answerFormat: "decision-brief" as const }, synthesisCount: 1 },
  { name: "unattended engine", input: { origin: "engine" as const }, synthesisCount: 0 },
])("preserves original admission boundaries: $name", async options => {
  const f = await drive(options);
  expect(f.run.teachingProposals).toBeUndefined();
  expect(f.synthesize).toHaveBeenCalledTimes(options.synthesisCount);
  for (const [input] of f.synthesize.mock.calls) expect(input).not.toHaveProperty("teachingRequest");
  if (!options.synthesisCount) expect(f.read).not.toHaveBeenCalled();
  expect(f.denied).not.toHaveBeenCalled();
});

it("keeps portable receipt/report projection bound to the original question, language labels and final facts", async () => {
  const f = await drive(), delivery = f.run.teachingProposals!;
  const wrongQuestion = structuredClone(delivery); wrongQuestion.request.questionSha256 = "a".repeat(64);
  expect(projectTeachingProposalDelivery(wrongQuestion, f.run)).toBeUndefined();
  const wrongLabel = structuredClone(delivery); wrongLabel.proposals[0].label = "Proposed classroom activity";
  expect(projectTeachingProposalDelivery(wrongLabel, f.run)?.proposals.map(row => row.proposal.id)).not.toContain("t1");
  const missingFact = { ...f.run, evidence: [], citedStatements: [] };
  expect(projectTeachingProposalDelivery(delivery, missingFact)?.proposals).toEqual([]);
  const hostile = structuredClone(delivery); hostile.proposals[0].proposal.text = "# forged [S99] **heading**";
  const rendered = teachingProposalAnswer(hostile);
  expect(rendered).not.toContain("# forged [S99] **heading**"); expect(rendered).toContain("\\# forged");
  for (const reason of ["missing-premise", "final-premise-withheld", "review-unavailable", "explanation-word-limit"] as const) {
    const answer = teachingProposalAnswer({ ...delivery, proposals: [], gaps: [{ reason }], complete: false });
    expect(answer).toContain("Propostas de ensino"); expect(answer).not.toContain("No proposal");
    if (reason === "explanation-word-limit") expect(answer).toContain("excede o limite de palavras");
  }
});
