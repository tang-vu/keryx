import { expect, it, vi } from "vitest";
import { runAgent } from "./run-agent";
import { HeuristicEngine } from "../llm/heuristic-engine";
import { extractHtml } from "../web-research/html-reader";
import type { ResearchEffects } from "./research-effects";
import type { AgentDeps } from "./deps";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import { API_INTEGRATION_NOTE_REQUEST } from "../research/api-integration-note-request";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { extractAnswerMarkers } from "./evidence-ledger";
import { fixtureEvidenceSpans } from "../../test-support/evidence-fixtures";

async function drive(note: boolean, originalQuestion?: string) {
  const url = "https://docs.example/api/v2", body = `What retry caveat applies? Use ${url}#limits`;
  const question = note ? `${API_INTEGRATION_NOTE_REQUEST}\n\n${body}` : body;
  const engine = new HeuristicEngine();
  const attribution = vi.spyOn(engine, "attribute");
  const quote = "On version two, a retry may duplicate delivery and is not an exactly-once guarantee.";
  // Controlled provider judgments exercise the real ledger/presentation path;
  // these are not live semantic-quality observations.
  const synthesis = vi.spyOn(engine, "synthesize").mockImplementation(async input => ({ answer: quote + " [S1]", citedMarkers: ["S1"], conflicts: [],
    evidence: fixtureEvidenceSpans(input.gathered, [{ claimIndex: 0, marker: "S1", quote, support: 0.9 }]) }));
  vi.spyOn(engine, "decompose").mockResolvedValue(["What retry caveat applies?"]);
  vi.spyOn(engine, "decide").mockImplementation(async input => input.candidates.map(row => ({ sourceId: row.id, sourceName: row.name,
    action: "BUY" as const, expectedValue: 0.9, confidence: 0.9, price: 0, targets: [0], rationale: "Synthetic free-original selection" })));
  vi.spyOn(engine, "sufficiency").mockResolvedValue({ sufficient: true, rationale: "Synthetic judgment",
    perClaim: [{ claim: "What retry caveat applies?", coverage: 0.9, coveredBy: ["S1"] }] });
  const denied = vi.fn(async () => { throw new Error("No payment in this synthetic fixture"); });
  const effects: ResearchEffects = { scope: { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: denied,
    saveQueryRun: vi.fn(async () => {}), saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const read = vi.fn(async (_url: string, signal?: AbortSignal) => extractHtml(`<html><body><h2 id="limits">Retry caveat</h2><p>${
    (quote + " ").repeat(3)}</p></body></html>`, url, signal, "limits"));
  const deps: AgentDeps = { db: { listSources: async () => [], listPublicReferences: async () => [] } as unknown as KeryxDB,
    engine, effects, readWebArticle: read, webSearch: { search: async () => [] },
    gateway: { mode: "offline", agentAddress: "0x0000000000000000000000000000000000000001", ensureFunded: denied,
      payFetch: denied, payCitation: denied } as unknown as PaymentGateway };
  const iterator = runAgent({ question, originalQuestion, origin: "web", budget: 0, researchMode: "quick" }, deps);
  let row = await iterator.next(); while (!row.done) row = await iterator.next();
  return { run: row.value, read, denied, synthesis, attribution };
}

it("uses an explicit API note request after evidence gates without changing markers, read count or source spend", async () => {
  const ordinary = await drive(false), note = await drive(true);
  expect(note.run.answer).toContain("### API integration note");
  expect(note.run.answer).toContain("Original excerpt"); expect(note.run.answer).toContain("heading section #limits");
  expect(note.run.answer).toContain("Implementation check — proposal");
  expect([...extractAnswerMarkers(note.run.answer)]).toEqual([...extractAnswerMarkers(ordinary.run.answer)]);
  expect(note.run.citations.map(row => row.marker)).toEqual(ordinary.run.citations.map(row => row.marker));
  expect(note.attribution.mock.calls[0][0].answer).toBe(ordinary.attribution.mock.calls[0][0].answer);
  expect(note.attribution.mock.calls[0][0].answer).not.toContain("API integration note");
  expect(note.read).toHaveBeenCalledOnce(); expect(note.denied).not.toHaveBeenCalled();
  expect(note.run.totalSpent).toBe(0); expect(note.synthesis).toHaveBeenCalledOnce();
  const receipt = buildResearchReceipt(note.run, []); expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.dispatch.answer).toBe(note.run.answer);
});

it("does not let augmented context select the note format for a different original request", async () => {
  const note = await drive(true, "Explain the retry constraint from the supplied original.");
  expect(note.run.answer).not.toContain("### API integration note");
});
