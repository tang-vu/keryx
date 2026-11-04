import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runAgent, type RunInput } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { ResearchEffects } from "./research-effects";
import type { ReasoningEngine } from "../llm/reasoning-engine";
import type { QueryRun, TraceStep } from "../types";
import { ResearchAdmissionHeldError } from "../research/availability-contract";
import { config } from "../config";

const guards = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("../business-operator/canary-policy", async original => ({
  ...await original<typeof import("../business-operator/canary-policy")>(), reserveCanarySearch: guards.search,
}));
const previous = { webSearchProvider: config.webSearchProvider, webSearchUrl: config.webSearchUrl, tavilyApiKey: config.tavilyApiKey };
beforeEach(() => {
  guards.search.mockReset(); Object.assign(config, { webSearchProvider: "tavily", tavilyApiKey: "SYNTHETIC_KEY" });
});
afterEach(() => { Object.assign(config, previous); vi.unstubAllGlobals(); });

function fixture(privateScope = false) {
  const denied = vi.fn(async () => { throw new Error("Synthetic search observation cannot move money or synthesize evidence"); });
  const db = { listSources: async () => [], listPublicReferences: async () => [], listRecentQueries: async () => [] } as unknown as KeryxDB;
  const engine = { name: "synthetic-search-observation", decompose: async () => Array.from({ length: 8 }, (_, i) => `Original target ${i}`),
    decide: denied, sufficiency: denied, reevaluate: denied, synthesize: denied, attribute: denied } as ReasoningEngine;
  const gateway = { agentAddress: "0x0000000000000000000000000000000000000001", ensureFunded: denied, payFetch: denied, payCitation: denied } as unknown as PaymentGateway;
  const queryId = privateScope ? "prv_synthetic-search-observation" : "synthetic-search-observation";
  const effects: ResearchEffects = { scope: privateScope ? { kind: "job", queryId } : { kind: "public" },
    recordPayment: denied, getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, saveQueryRun: async () => {},
    discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }), saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const deps: AgentDeps = { engine, db, gateway, effects };
  const input: RunInput = { queryId, question: "Explain the recorded operation.", origin: "web", researchMode: "quick", budget: 0 };
  return { deps, input, denied };
}

async function drive(deps: AgentDeps, input: RunInput): Promise<{ run: QueryRun; steps: TraceStep[] }> {
  const generator = runAgent(input, deps), steps: TraceStep[] = [];
  for (;;) {
    const value = await generator.next();
    if (value.done) return { run: value.value, steps };
    steps.push(value.value);
  }
}
function searchStep(steps: TraceStep[]) { return steps.find(step => step.message.startsWith("Web search:")); }

it.each(["quick", "deep"] as const)("retains actual %s search counts and zero evidence/money with typed admission refusal", async researchMode => {
  const f = fixture(), fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  guards.search.mockImplementation(() => { throw new ResearchAdmissionHeldError("SECRET ORIGINAL PATH AND HOLD DETAIL"); });
  const { run, steps } = await drive(f.deps, { ...f.input, researchMode });
  const count = researchMode === "quick" ? 2 : 9, step = searchStep(steps)!;
  expect(step.message).toContain(`${count}/${count} planned queries attempted, 0 succeeded`);
  expect(step.message).toContain(`${count} unavailable queries`);
  expect(step.detail).toEqual({ kind: "public-search-failures-v1", admissionHeld: count, signalAborted: 0, unclassified: 0 });
  expect(run.trace.find(row => row.message === step.message)?.detail).toEqual(step.detail);
  expect(JSON.parse(JSON.stringify(step.detail))).toEqual(step.detail); expect(JSON.stringify(step.detail)).not.toMatch(/SECRET|PATH|HOLD|KEY|target|question/);
  expect(guards.search).toHaveBeenCalledTimes(count); expect(fetch).not.toHaveBeenCalled(); expect(f.denied).not.toHaveBeenCalled();
  expect(run.citations).toEqual([]); expect(run.totalSpent).toBe(0); expect(run.totalToCreators).toBe(0);
});

it("retains opaque custom provider failures without borrowing trusted constructor provenance", async () => {
  const f = fixture(), search = vi.fn(async () => { throw new ResearchAdmissionHeldError("CUSTOM FORGED ADMISSION"); });
  f.deps.webSearch = { search }; vi.stubGlobal("fetch", vi.fn());
  const { run, steps } = await drive(f.deps, f.input);
  expect(search).toHaveBeenCalledTimes(2); expect(guards.search).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(searchStep(steps)?.detail).toBeUndefined(); expect(searchStep(steps)?.message).toContain("2 unavailable queries");
  expect(run.citations).toEqual([]); expect(f.denied).not.toHaveBeenCalled();
});

it("leaves configured Searx failures on the exact existing path", async () => {
  const f = fixture(), fetch = vi.fn(async () => new Response("synthetic unavailable", { status: 503 })); vi.stubGlobal("fetch", fetch);
  Object.assign(config, { webSearchProvider: "searxng", webSearchUrl: "http://127.0.0.1:4444/" });
  const { steps } = await drive(f.deps, f.input);
  expect(fetch).toHaveBeenCalledTimes(2); expect(guards.search).not.toHaveBeenCalled();
  expect(searchStep(steps)?.detail).toBeUndefined(); expect(searchStep(steps)?.message).toContain("2 unavailable queries");
  expect(f.denied).not.toHaveBeenCalled();
});

it.each(["private", "private-opt-in", "unattended"])("keeps %s withholding ahead of provider construction/dispatch", async mode => {
  const f = fixture(mode !== "unattended"), fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const { steps } = await drive(f.deps, { ...f.input, ...(mode === "unattended" ? { origin: "engine" } : {}), ...(mode === "private-opt-in" ? { allowExternalWeb: true } : {}) });
  expect(steps.some(step => step.message.includes("External web search withheld"))).toBe(true);
  expect(searchStep(steps)).toBeUndefined(); expect(guards.search).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(f.denied).not.toHaveBeenCalled();
});

it("retains existing explicit unattended opt-in without granting extra requests", async () => {
  const f = fixture(), fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  guards.search.mockImplementation(() => { throw new ResearchAdmissionHeldError("synthetic held"); });
  const { steps } = await drive(f.deps, { ...f.input, origin: "engine", allowExternalWeb: true });
  expect(guards.search).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled(); expect(searchStep(steps)?.detail).toMatchObject({ admissionHeld: 2 });
});

it("omits failure metadata for actual successful empty vendor searches", async () => {
  const f = fixture(), fetch = vi.fn(async () => new Response(JSON.stringify({ results: [] }))); vi.stubGlobal("fetch", fetch);
  const { steps } = await drive(f.deps, f.input);
  expect(guards.search).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledTimes(2);
  expect(searchStep(steps)?.message).toContain("2 succeeded"); expect(searchStep(steps)?.detail).toBeUndefined(); expect(f.denied).not.toHaveBeenCalled();
});

it("keeps vendor errors unclassified despite forged admission text", async () => {
  const f = fixture(), fetch = vi.fn(async () => { throw new ResearchAdmissionHeldError("FORGED VENDOR SECRET"); }); vi.stubGlobal("fetch", fetch);
  const { steps } = await drive(f.deps, f.input);
  expect(guards.search).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledTimes(2);
  expect(searchStep(steps)?.detail).toEqual({ kind: "public-search-failures-v1", admissionHeld: 0, signalAborted: 0, unclassified: 2 });
  expect(f.denied).not.toHaveBeenCalled();
});

it("retains constructor configuration failure without inventing dispatched attempts", async () => {
  const f = fixture(), fetch = vi.fn(); vi.stubGlobal("fetch", fetch); Object.assign(config, { tavilyApiKey: "" });
  const { steps } = await drive(f.deps, f.input);
  expect(searchStep(steps)?.message).toContain("0/0 planned queries attempted");
  expect(searchStep(steps)?.message).toContain("search configuration unavailable"); expect(searchStep(steps)?.detail).toBeUndefined();
  expect(guards.search).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(f.denied).not.toHaveBeenCalled();
});
