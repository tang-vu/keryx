import { afterEach, expect, it, vi } from "vitest";
import { runAgent, type RunInput } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { ReasoningEngine, ProposedEvidence, SynthInput } from "../llm/reasoning-engine";
import { prepareTeachingProposals, reviewTeachingProposals } from "../research/teaching-proposals";
import { surfaceResearch } from "../research/surface-result";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";
import { projectTeachingProposalDelivery } from "../research/teaching-proposals-surface";

const question = "I teach grade 7. Propose a 10-minute classroom activity, two classification examples and one exit question with an answer. Write in English: explanation under 100 words. Label activities and invented examples as proposed. Read https://www.nasa.gov/lesson and do not buy paid sources.";
const quotes = ["Weather describes atmospheric conditions over a short period.", "Climate describes average weather over a long period."];
const text = quotes.join(" ");
afterEach(() => vi.unstubAllEnvs());

function fixture(options: { climateCovered?: boolean; rejectExample?: boolean } = {}) {
  const payment = vi.fn(async () => { throw new Error("A proposed activity must never authorize payment"); });
  const attribute = vi.fn(async (input: { answer: string; used: { sourceId: string }[] }) =>
    input.used.map(row => ({ sourceId: row.sourceId, weight: 1, rationale: "Factual excerpt contribution" })));
  const synthesize = vi.fn(async (input: SynthInput) => {
    const marker = input.gathered[0].marker;
    const evidence: ProposedEvidence[] = quotes.map((quote, claimIndex) => ({ claimIndex, marker, quote, support: 0.9,
      statementSupport: 0.9, statement: quote, quoteSpan: { start: text.indexOf(quote), end: text.indexOf(quote) + quote.length } }));
    const raw = [
      { id: "t1", kind: "activity", text: "Sort proposed cards into short-term and long-term descriptions.", durationMinutes: 10, premiseIds: ["e1", "e2"], conditions: [] },
      { id: "t2", kind: "classification-example", text: "Invented scenario: rain today.", answer: "Weather.", premiseIds: ["e1"], conditions: [] },
      { id: "t3", kind: "classification-example", text: "Invented scenario: average rainfall over decades.", answer: "Climate.", premiseIds: ["e2"], conditions: [] },
      { id: "t4", kind: "exit-question", text: "Which concept describes a long-term average?", answer: "Climate.", premiseIds: ["e2"], conditions: [] },
    ];
    const prepared = input.teachingRequest ? prepareTeachingProposals(input.teachingRequest, input.question, evidence, raw) : undefined;
    const packet = prepared?.packet;
    const reviewed = packet ? reviewTeachingProposals(packet, { digest: packet.digest,
      proposals: packet.proposals.map(proposal => ({ id: proposal.id, premiseIds: proposal.premiseIds,
        premiseConsistency: "supported", conditions: "supported", instructionalConsistency: "supported",
        sourceAttribution: "supported", requestedScope: "supported",
        language: options.rejectExample && proposal.id === "t2" ? "unsupported" : "supported" })) }) : undefined;
    return { answer: `[${marker}]`, citedMarkers: [marker], evidence, evidenceReview: "reviewed" as const,
      ...(prepared ? { teachingProposals: { reviewed, preparationGaps: prepared.gaps } } : {}) };
  });
  const engine = { name: "test-teaching", decompose: async () => ["weather", "climate"],
    decide: async (input: { candidates: { id: string; name: string }[] }) => input.candidates.map(c => ({ sourceId: c.id,
      sourceName: c.name, action: "BUY", expectedValue: 0.9, price: 0, confidence: 0.9, rationale: "Read the caller's free original", targets: [0, 1] })),
    sufficiency: async (input: { subClaims: string[]; gathered: { marker: string }[] }) => ({ sufficient: true, rationale: "Fixture assessment",
      perClaim: input.subClaims.map((claim, index) => ({ claim, coverage: index === 1 && options.climateCovered === false ? 0 : 0.9,
        coveredBy: input.gathered.map(row => row.marker) })) }),
    reevaluate: async () => ({ shouldBuyMore: false, recommendedIds: [], rationale: "No additional fixture reads" }),
    synthesize, attribute } as unknown as ReasoningEngine;
  const effects: ResearchEffects = { scope: { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: payment,
    saveQueryRun: async () => {}, saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const db = { listSources: async () => [], listPublicReferences: async () => [] } as unknown as KeryxDB;
  const gateway = { mode: "real", agentAddress: () => "0x0000000000000000000000000000000000000001",
    ensureFunded: payment, payFetch: payment, payCitation: payment } as unknown as PaymentGateway;
  const read = vi.fn(async (url: string) => ({ finalUrl: url, text, title: "Synthetic classroom source", kind: "text" as const, truncated: false }));
  const deps: AgentDeps = { db, engine, gateway, effects, readWebArticle: read,
    webSearch: { search: async () => [] } as unknown as AgentDeps["webSearch"] };
  return { deps, payment, synthesize, attribute, read };
}
async function drive(input: Partial<RunInput>, deps: AgentDeps) {
  const generator = runAgent({ queryId: "lesson-fixture", question, origin: "web", budget: 0, researchMode: "quick", ...input }, deps);
  let row = await generator.next();
  while (!row.done) row = await generator.next();
  return row.value;
}

it("delivers the requested proposal counts after final factual admission without changing attribution/payment", async () => {
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", "1");
  const f = fixture(), run = await drive({}, f.deps);
  expect(run.teachingProposals).toMatchObject({ complete: true, explanationWords: 16 });
  expect(run.teachingProposals!.proposals.map(row => row.proposal.kind)).toEqual(["activity", "classification-example", "classification-example", "exit-question"]);
  expect(run.answer).toContain("Proposed classroom activity (10 minutes)");
  expect(run.answer).toContain("Invented scenario: rain today.");
  expect(f.attribute.mock.calls[0][0].answer).not.toContain("Teaching proposals");
  expect(run.citations).toHaveLength(1); expect(run.citations[0].reward).toBe(0);
  expect(run.evidence).toHaveLength(2); expect(run.totalSpent).toBe(0); expect(f.payment).not.toHaveBeenCalled();
  expect(f.read).toHaveBeenCalledOnce(); expect(f.synthesize).toHaveBeenCalledOnce();
  expect(surfaceResearch(run).teachingProposals).toEqual(run.teachingProposals);
  const receipt = buildResearchReceipt(run, []);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.teachingProposals).toEqual(run.teachingProposals);
  expect(researchReportMarkdown(run, null, [])).toContain("Proposed classroom activity (10 minutes)");
});
it("retains valid siblings and withholds proposals whose factual premises fail final admission", async () => {
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", "1");
  const f = fixture({ climateCovered: false }), run = await drive({}, f.deps);
  expect(run.teachingProposals!.complete).toBe(false);
  expect(run.teachingProposals!.proposals.map(row => row.proposal.id)).toEqual(["t2"]);
  expect(run.answer).not.toContain("average rainfall over decades");
  expect(run.answer).toContain("The requested activity could not be delivered completely");
  expect(f.payment).not.toHaveBeenCalled();
});
it("keeps independently rejected invented examples out while delivering accepted siblings", async () => {
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", "1");
  const f = fixture({ rejectExample: true }), run = await drive({}, f.deps);
  expect(run.teachingProposals!.proposals.map(row => row.proposal.id)).toEqual(["t1", "t3", "t4"]);
  expect(run.teachingProposals!.complete).toBe(false);
  expect(run.answer).not.toContain("Invented scenario: rain today");
  expect(run.evidence).toHaveLength(2);
});
it.each([
  { name: "flag disabled", enabled: false, input: {} },
  { name: "augmented prior context", enabled: true, input: { originalQuestion: question, question: `${question}\nPrior context` } },
  { name: "bounded package", enabled: true, input: { executionLimits: { attentionLimit: 1, reevaluateRounds: 0 } } },
  { name: "decision brief", enabled: true, input: { answerFormat: "decision-brief" as const } },
  { name: "unattended engine", enabled: true, input: { origin: "engine" as const } },
])("keeps the existing synthesis input for $name", async ({ enabled, input }) => {
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", enabled ? "1" : "0");
  const f = fixture(), run = await drive(input, f.deps);
  if (input.origin === "engine") { expect(f.read).not.toHaveBeenCalled(); expect(f.synthesize).not.toHaveBeenCalled(); }
  else { expect(f.synthesize).toHaveBeenCalledOnce(); expect(f.synthesize.mock.calls[0][0]).not.toHaveProperty("teachingRequest"); }
  expect(run).not.toHaveProperty("teachingProposals");
});
it("does not promote a corrupt portable proposal role or manufacture a missing premise", async () => {
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", "1");
  const run = await drive({}, fixture().deps), copy = structuredClone(run.teachingProposals!);
  copy.proposals[0].premises[0].statement.quote = "This quote was never read.";
  const projected = projectTeachingProposalDelivery(copy, run)!;
  expect(projected.complete).toBe(false); expect(projected.proposals.map(row => row.proposal.id)).not.toContain("t1");
  const injected = structuredClone(run.teachingProposals!);
  injected.proposals[0].proposal.text = "NASA tested this [S900] activity.";
  expect(projectTeachingProposalDelivery(injected, run)).toBeUndefined();
});

it("withdraws portable proposals when final coverage or physical evidence identity is lost", async () => {
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", "1");
  const run = await drive({}, fixture().deps);
  const uncovered = { ...run, claimCoverage: run.claimCoverage!.map(row => ({ ...row, coverage: 0, coveredBy: [] })) };
  const held = projectTeachingProposalDelivery(run.teachingProposals, uncovered)!;
  expect(held.complete).toBe(false); expect(held.proposals).toEqual([]); expect(held.admittedStatements).toEqual([]);
  const ambiguous = structuredClone(run), original = ambiguous.evidence![0];
  ambiguous.evidence!.push({ ...original, sourceId: "public:other", itemUrl: "https://other.example.test/lesson" });
  ambiguous.citations.push({ ...ambiguous.citations[0], sourceId: "public:other", itemUrl: "https://other.example.test/lesson" });
  expect(projectTeachingProposalDelivery(run.teachingProposals, ambiguous)!.proposals.map(row => row.proposal.id)).toEqual(["t3", "t4"]);
});
it("binds portable premise text and counts to retained final statements and the original request", async () => {
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", "1");
  const run = await drive({}, fixture().deps), changed = structuredClone(run.teachingProposals!);
  changed.proposals[0].premises[0].statement.text = "NASA independently tested this activity in class.";
  changed.explanationWords = 0;
  const projected = projectTeachingProposalDelivery(changed, run)!;
  expect(projected.proposals.map(row => row.proposal.id)).not.toContain("t1"); expect(projected.explanationWords).toBe(16);
  expect(projectTeachingProposalDelivery(changed, { ...run, question: "A different question" })).toBeUndefined();
  const missing = { ...run.teachingProposals, admittedStatements: undefined };
  expect(projectTeachingProposalDelivery(missing, run)).toBeUndefined();
});
it("withholds excess portable examples instead of selecting a manufactured requested count", async () => {
  vi.stubEnv("KERYX_TEACHING_PROPOSALS", "1");
  const run = await drive({}, fixture().deps), changed = structuredClone(run.teachingProposals!);
  changed.proposals.push({ ...changed.proposals[1], proposal: { ...changed.proposals[1].proposal, id: "t5" } });
  const projected = projectTeachingProposalDelivery(changed, run)!;
  expect(projected.proposals.map(row => row.proposal.kind)).toEqual(["activity", "exit-question"]); expect(projected.complete).toBe(false);
});
