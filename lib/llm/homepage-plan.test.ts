import { afterEach, describe, expect, it, vi } from "vitest";
import { collectRun } from "../agent";
import type { AgentDeps } from "../agent/deps";
import type { ResearchEffects } from "../agent/research-effects";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { ResearchPlanningError } from "./research-plan";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Exact current homepage question. Responses below are controlled fixtures,
// not retained provider output, vendor documentation or a live model/search call.
const question = "Compare SQLite WAL and rollback journals for a small web application. What are the concurrency and operational tradeoffs?";
const parts = [
  { role: "framing", text: "Compare" },
  { role: "subject", text: "SQLite WAL" },
  { role: "framing", text: "and" },
  { role: "subject", text: "rollback journals" },
  { role: "scope", text: "for a small web application." },
  { role: "framing", text: "What are the" },
  { role: "dimension", text: "concurrency" },
  { role: "framing", text: "and" },
  { role: "dimension", text: "operational tradeoffs" },
  { role: "framing", text: "?" },
];
const facts = [
  "WAL allows readers and a writer to proceed concurrently.",
  "WAL requires checkpointing and the associated WAL file.",
  "Rollback journals prevent readers from observing an incomplete transaction.",
  "A rollback-journal writer needs exclusive access before committing changes.",
];
const urls = ["https://docs.example.org/wal", "https://docs.example.org/rollback"];

function dependencies(output: Record<string, unknown>) {
  const planningCalls: unknown[] = [], reviewCalls: unknown[] = [];
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const wire = JSON.parse(init!.body as string);
    const user = wire.messages[1].content as string;
    let value: unknown;
    if (user.startsWith("User question (data):")) { planningCalls.push(wire); value = output; }
    else {
      const body = JSON.parse(user);
      if (Array.isArray(body.candidates)) {
        value = { decisions: body.candidates.map((candidate: { sourceId: string; articleUrl?: string }) => {
          const index = urls.indexOf(candidate.articleUrl ?? "");
          return { sourceId: candidate.sourceId, action: index >= 0 ? "CACHE" : "SKIP", expectedValue: index >= 0 ? 1 : 0,
            confidence: 0.9, rationale: "Controlled discovery hypothesis, not evidence.",
            targets: index === 0 ? [0, 1] : index === 1 ? [2, 3] : [] };
        }) };
      } else if (Array.isArray(body.quoteOptions)) {
        value = { evidence: facts.map((statement, claimIndex) => {
          const option = (body.quoteOptions as Array<{ quoteId: string; marker: string; text: string }>).find(row => row.text === statement);
          expect(option).toBeDefined();
          return { claimIndex, marker: option!.marker, quoteId: option!.quoteId, support: 0.9, statement };
        }), conflicts: [] };
      } else if (Array.isArray(body.evidence)) {
        reviewCalls.push(body);
        value = { reviews: body.evidence.map((row: { index: number; statement: string }) => ({ index: row.index,
          supportedFact: row.statement, support: 0.9, statementSupport: 0.9, statementLanguage: "en" })) };
      } else if (Array.isArray(body.gathered)) {
        value = { rationale: "Controlled per-target assessment.", perClaim: body.subClaims.map((claim: string, index: number) => ({ claim,
          coverage: body.gathered.length === 2 ? 0.9 : 0, supportedAnswer: facts[index],
          missingRequestedParts: body.gathered.length === 2 ? [] : ["The other comparison subject has not been read."],
          coveredBy: body.gathered.length === 2 ? [index < 2 ? "S1" : "S2"] : [] })) };
      } else throw new Error("Unexpected controlled reasoning packet");
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 40, completion_tokens: 20 } });
  });
  vi.stubGlobal("fetch", transport);
  const engine = new OpenAICompatibleEngine({ name: "llm:homepage-controlled", baseUrl: "https://controlled.invalid", apiKey: "fixture", model: "fixture" });
  const effects: ResearchEffects = { scope: { kind: "public" }, recordPayment: vi.fn(async () => {}),
    getCached: vi.fn(async () => null), getCachedAt: vi.fn(async () => null), setCached: vi.fn(async () => {}),
    saveQueryRun: vi.fn(async () => {}), discoverExternal: vi.fn(async () => []), decisionContext: vi.fn(async () => ({ sample: 0 })),
    saveMemory: vi.fn(async () => {}), notifyCitation: vi.fn(), alert: vi.fn(), activation: vi.fn(async () => {}) };
  const gateway = { mode: "offline", ensureFunded: vi.fn(), payFetch: vi.fn(), payCitation: vi.fn() };
  const deps = { engine, effects, gateway, db: { listSources: vi.fn(async () => []) },
    webSearch: { search: vi.fn(async () => urls.map((url, index) => ({ url, title: `Controlled comparison document ${index}`,
      snippet: "Discovery preview only; original must be read." }))) },
    readWebArticle: vi.fn(async (url: string) => ({ text: facts.slice(url === urls[0] ? 0 : 2, url === urls[0] ? 2 : 4).join(" "),
      title: "Controlled comparison original", finalUrl: url, kind: "html", truncated: false })) } as unknown as AgentDeps;
  return { deps, engine, effects, gateway, transport, planningCalls, reviewCalls };
}

describe("homepage comparison reaches a supported answer", () => {
  it.each([false, true])("uses the complete caller-bound comparison with trimmed boundaries and redundant scope=%s", async redundantScope => {
    const d = dependencies({ status: "complete", comparison: { parts }, ...(redundantScope ? { constraints: ["for a small web application."] } : {}) });
    const run = await collectRun({ question, origin: "web", budget: 0, researchMode: "quick" }, { deps: d.deps });
    expect(run.subClaims).toHaveLength(4);
    for (const subject of ["SQLite WAL", "rollback journals"]) for (const dimension of ["concurrency", "operational tradeoffs"]) {
      expect(run.subClaims.filter(target => target.startsWith(`${subject}: ${dimension}?`))).toHaveLength(1);
    }
    expect(run.subClaims.every(target => target.includes("for a small web application."))).toBe(true);
    expect(d.planningCalls).toHaveLength(1);
    expect(d.reviewCalls).toHaveLength(1);
    expect(d.deps.readWebArticle).toHaveBeenCalledTimes(2);
    for (const statement of facts) expect(run.answer).toContain(statement);
    expect(run.answer).not.toMatch(/valid plan|No supported answer|no qualifying excerpts/i);
    expect(run.evidence).toHaveLength(4);
    expect(run.evidence!.every(row => row.qualifiesForAnswer && !row.qualifiesForReward)).toBe(true);
    expect(run.totalSpent).toBe(0); expect(run.totalToCreators).toBe(0);
    expect(d.gateway.ensureFunded).not.toHaveBeenCalled(); expect(d.gateway.payFetch).not.toHaveBeenCalled(); expect(d.gateway.payCitation).not.toHaveBeenCalled();
    expect(d.effects.saveQueryRun).toHaveBeenCalledWith(run);
  });

  it("refuses nine independent targets before discovery, reads or payment without a repair call", async () => {
    const d = dependencies({ status: "complete", claims: Array.from({ length: 9 }, (_, index) => `Independent need ${index}?`) });
    await expect(collectRun({ question, origin: "web", budget: 0, researchMode: "quick" }, { deps: d.deps }))
      .rejects.toBeInstanceOf(ResearchPlanningError);
    expect(d.planningCalls).toHaveLength(1); expect(d.transport).toHaveBeenCalledOnce();
    expect(d.deps.webSearch!.search).not.toHaveBeenCalled(); expect(d.deps.readWebArticle).not.toHaveBeenCalled();
    expect(d.gateway.ensureFunded).not.toHaveBeenCalled(); expect(d.gateway.payFetch).not.toHaveBeenCalled(); expect(d.gateway.payCitation).not.toHaveBeenCalled();
  });
});
