import { DatabaseSync } from "node:sqlite";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { HeuristicEngine } from "../llm/heuristic-engine";
import { ResilientEngine } from "../llm/resilient-engine";
import { LlmCallLedger } from "../llm/call-ledger";
import { ResearchPlanningError } from "../llm/research-plan";
import type { AgentDeps } from "../agent";
import type { KeryxDB } from "../db";
import type { LlmUsageRecord, ReasoningEngine } from "../llm/reasoning-engine";
import type { QueryRun } from "../types";

// Real POST -> collectRun -> runAgent -> request-local resilient engine ->
// genuine SQLite creation/default-visibility/permalink readers. Only dependency
// selection, authentication and external admission/transports are controlled.
const boundary = vi.hoisted(() => ({ db: vi.fn(), deps: vi.fn(), key: vi.fn(), session: vi.fn(),
  admission: vi.fn(), claim: vi.fn(), complete: vi.fn(), decompose: vi.fn(), outbound: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: boundary.db }));
vi.mock("@/lib/agent/deps", () => ({ getAgentDeps: boundary.deps }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: boundary.key }));
vi.mock("@/lib/auth", () => ({ getSession: boundary.session }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: boundary.admission }));
vi.mock("@/lib/run-claims/hosted-delivery", () => ({ prepareHostedRunClaim: boundary.claim }));
vi.mock("@/lib/llm", () => ({ resolveModelChoice: () => undefined }));
vi.mock("@/lib/research/availability", () => ({ readResearchAvailability: () => ({ state: "not-paused" }) }));
vi.mock("@/lib/config", async () => ({ config: {
  profile: (await import("../arc-network-profile")).ARC_TESTNET_PROFILE,
  networkId: "eip155:5042002", baseUrl: "https://planning-api.example", botKey: "",
  sellerAddress: `0x${"2".repeat(40)}`, defaultBudget: 0.05, anonMaxBudget: 0.03, a2aMaxBudget: 0.5,
  citationPoolRatio: 0.5, maxAttentionSources: 2, reevaluateRounds: 0, devWallets: [], llmTimeoutMs: 1000,
} }));
// Never consult or consume any retained production/canary allowance.
vi.mock("@/lib/business-operator/canary-policy", async original => ({
  ...await original<typeof import("../business-operator/canary-policy")>(), admitBusinessCanaryRun: () => null,
}));
vi.mock("@/lib/research/research-allowance", async original => ({
  ...await original<typeof import("../research/research-allowance")>(), admitBoundedResearch: () => null,
}));

import { POST } from "../../app/api/v1/chat/completions/route";
import { GET as dispatch } from "../../app/api/dispatch/[id]/route";
import * as agent from "../agent";

const OWNER = `0x${"a".repeat(40)}`, OTHER = `0x${"b".repeat(40)}`;
const QUESTION = "Synthetic original planning request";
const binding = { network: "eip155:5042002" as const, origin: "https://planning-api.example" };
let native: DatabaseSync, db: KeryxDB, deps: AgentDeps;
let saved: ReturnType<typeof vi.fn>, gateway: AgentDeps["gateway"];
let usage: LlmUsageRecord[], ledger: LlmCallLedger;

beforeEach(() => {
  vi.clearAllMocks();
  native = new DatabaseSync(":memory:"); installSqliteApplicationSchema(native); native.exec(RUN_PRIVACY_SQL);
  const privacy = createSqliteRunPrivacy(native);
  saved = vi.fn(async (run: QueryRun) => writeSqliteQueryRun(native, run, true, {
    privacy: { runPrivacyActive: true, runPrivacy: privacy }, enrolled: false,
  }));
  db = { runPrivacyActive: true, runPrivacy: privacy, saveQueryRun: saved, incrementUsage: vi.fn(),
    listSources: vi.fn(() => { throw Error("Discovery is forbidden in the planning fixture"); }) } as unknown as KeryxDB;
  ledger = new LlmCallLedger(); usage = [];
  const offline = new HeuristicEngine();
  const primary: ReasoningEngine = { name: "synthetic-planner", get usage() { return usage; }, get calls() { return ledger.calls; },
    decompose: question => ledger.track("synthetic-planner", async () => {
      usage.push({ callId: ledger.currentId, engine: "synthetic-planner", model: "synthetic", inputTokens: 37,
        cachedInputTokens: null, outputTokens: 19 });
      return boundary.decompose(question);
    }), decide: offline.decide.bind(offline), sufficiency: offline.sufficiency.bind(offline),
    reevaluate: offline.reevaluate.bind(offline), synthesize: offline.synthesize.bind(offline), attribute: offline.attribute.bind(offline) };
  gateway = { mode: "offline", agentAddress: () => `0x${"2".repeat(40)}`,
    ensureFunded: vi.fn(), payFetch: vi.fn(), payCitation: vi.fn() };
  deps = { db, engine: new ResilientEngine(primary), gateway, discoverExternal: vi.fn() };
  boundary.db.mockResolvedValue(db); boundary.deps.mockResolvedValue(deps);
  boundary.key.mockResolvedValue({ walletAddress: OWNER, keyId: "synthetic-key", scopes: "ask" });
  boundary.session.mockResolvedValue(null); boundary.admission.mockResolvedValue(null); boundary.claim.mockResolvedValue(null);
  boundary.decompose.mockRejectedValue(new ResearchPlanningError(QUESTION, "invalid_output", 2048));
  boundary.complete.mockImplementation(async (run: QueryRun) => {
    expect(native.prepare("SELECT id FROM query_runs WHERE id=?").get(run.id)).toBeDefined();
    return { version: 1, runId: run.id, status: "available", delivery: { version: 1,
      claimUrl: "https://planning-api.example/claim-run#" + "a".repeat(64), expiresAt: "2026-10-20T00:00:00Z" } };
  });
  boundary.outbound.mockImplementation(() => { throw Error("No outbound transport in planning fixture"); });
  vi.stubGlobal("fetch", boundary.outbound);
});
afterEach(() => {
  try {
    expect(boundary.outbound).not.toHaveBeenCalled();
    for (const fn of [gateway.ensureFunded, gateway.payFetch, gateway.payCitation, deps.discoverExternal]) expect(fn).not.toHaveBeenCalled();
    expect(native.prepare("SELECT count(*) n FROM payment_events").get()?.n).toBe(0);
  } finally { native.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

function request(stream: boolean, owned = true, signal?: AbortSignal) {
  return new NextRequest(binding.origin + "/api/v1/chat/completions", { method: "POST", signal,
    headers: { "content-type": "application/json", ...(owned ? { authorization: "Bearer kx_live_synthetic" } : {}) },
    body: JSON.stringify({ messages: [{ role: "user", content: QUESTION }], budget: 1, stream,
      asker: OTHER, fundingOwner: "browser", askerFunded: true, visibility: "public" }) });
}
function chunks(wire: string) {
  return wire.split("\n\n").filter(part => part.startsWith("data: {"))
    .map(part => JSON.parse(part.slice(6)));
}
function failure(response: Response, wire: string, stream: boolean) {
  expect(response.status).toBe(stream ? 200 : 422);
  if (!stream) return { error: JSON.parse(wire).error, packet: JSON.parse(wire).keryx_private };
  const rows = chunks(wire), terminal = rows.at(-1);
  expect(wire).not.toContain("[DONE]");
  expect(rows.every(row => row.choices[0].finish_reason === null && !row.keryx)).toBe(true);
  expect(terminal.choices[0].delta.content).toContain("[keryx error]");
  return { error: terminal.keryx_error, packet: terminal.keryx_private };
}

it.each([false, true].flatMap(stream => (["public", "private", "unlisted"] as const).map(visibility => ({ stream, visibility }))))
  ("saves one genuine $visibility planning refusal with measured model usage, stream=$stream", async ({ stream, visibility }) => {
    // Fixture seed only. Exercise the real default read inside atomic creation;
    // changing account preferences/authentication is covered by its own tests.
    native.prepare("INSERT INTO run_privacy_defaults(wallet,visibility) VALUES(?,?)").run(OWNER, visibility);
    const response = await POST(request(stream)), wire = await response.text();
    const { error } = failure(response, wire, stream);
    expect(error).toMatchObject({ code: "research_plan_refinement_required", reportSaved: true,
      planningFailure: { version: 1, stage: "decompose", reason: "invalid_output", maximumTargets: 8, automaticRetry: false, outputTokenLimit: 2048 } });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(saved).toHaveBeenCalledOnce(); expect(boundary.deps).toHaveBeenCalledExactlyOnceWith({ model: undefined });
    expect(boundary.decompose).toHaveBeenCalledExactlyOnceWith(QUESTION);
    const run = saved.mock.calls[0][0] as QueryRun;
    expect(error).toMatchObject({ queryId: run.id, dispatchUrl: `${binding.origin}/dispatch/${run.id}` });
    if (stream) expect(chunks(wire)[0].id).toBe(`chatcmpl-${run.id}`);
    expect(run).toMatchObject({ id: expect.any(String), question: QUESTION, budget: 0.5, researchMode: "deep",
      asker: OWNER, askerFunded: false, origin: "a2a", fundingOwner: "offline", paymentMode: "offline",
      provenance: { version: 1, surface: "api", ownershipMethod: "api-key" },
      subClaims: [], decisions: [], citations: [], evidence: [], totalSpent: 0, totalToCreators: 0,
      llmUsage: [{ inputTokens: 37, outputTokens: 19, cachedInputTokens: null }], llmCalls: [{ outcome: "failed" }],
      reasoningAttempts: [{ step: "decompose", outcome: "failed", error: "output_validation" }] });
    expect(run.trace.at(-1)?.phase).toBe("verdict"); expect(run.trace.some(step => step.phase === "done")).toBe(false);
    expect(run.usage?.cohort).toBe("unknown");
    for (const wallet of [null, OTHER, OWNER]) {
      boundary.session.mockResolvedValue(wallet ? { address: wallet } : null);
      const read = await dispatch(new NextRequest(`${binding.origin}/api/dispatch/${run.id}`), { params: Promise.resolve({ id: run.id }) });
      expect(read.status).toBe(visibility === "private" && wallet !== OWNER ? 404 : 200);
      if (read.status === 200) expect(await read.json()).toMatchObject({ id: run.id, planningFailure: run.planningFailure });
    }
    expect((await db.runPrivacy!.read(run.id, { wallet: OWNER, binding })).item?.state.visibility).toBe(visibility);
    expect(wire).not.toContain(OWNER); expect(wire).not.toContain(OTHER);
  });

it.each([false, true])("keeps the anonymous claim private and only completes it after persistence, stream=%s", async stream => {
  boundary.claim.mockResolvedValue({ complete: boundary.complete });
  const response = await POST(request(stream, false)), wire = await response.text();
  const { error, packet } = failure(response, wire, stream);
  expect(error.reportSaved).toBe(true); expect(packet.status).toBe("available");
  const run = saved.mock.calls[0][0] as QueryRun;
  expect(run.asker).toBeUndefined(); expect(run.askerFunded).not.toBe(true); expect(run.budget).toBe(0.03);
  expect(run.provenance).toEqual({ version: 1, surface: "api", ownershipMethod: "unknown" });
  expect(boundary.complete).toHaveBeenCalledExactlyOnceWith(run);
  expect(native.prepare("SELECT data FROM query_runs WHERE id=?").get(run.id)?.data).not.toContain("claim-run#");
  expect(JSON.stringify(error)).not.toContain("claim-run#");
});

it.each([false, true])("keeps the original refusal unsaved when storage fails without exposing raw storage text, stream=%s", async stream => {
  boundary.claim.mockResolvedValue({ complete: boundary.complete }); saved.mockRejectedValue(new Error("PRIVATE_STORAGE_TEXT"));
  const response = await POST(request(stream, false)), wire = await response.text();
  const { error, packet } = failure(response, wire, stream);
  expect(error.reportSaved).toBe(false); expect(error).not.toHaveProperty("queryId"); expect(error).not.toHaveProperty("dispatchUrl");
  expect(packet).toBeUndefined(); expect(boundary.complete).not.toHaveBeenCalled(); expect(wire).not.toContain("PRIVATE_STORAGE_TEXT");
});

it.each([false, true])("does not save an aborted planning failure, stream=%s", async stream => {
  const abort = new AbortController(); boundary.decompose.mockImplementation(async () => {
    abort.abort(); throw new ResearchPlanningError(QUESTION, "needs_refinement");
  });
  const response = await POST(request(stream, true, abort.signal)); await response.text();
  expect(saved).not.toHaveBeenCalled(); expect(boundary.complete).not.toHaveBeenCalled();
});

it("does not save or complete a private claim after the stream reader cancels", async () => {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  boundary.claim.mockResolvedValue({ complete: boundary.complete });
  boundary.decompose.mockImplementation(async () => { entered(); await waiting; throw new ResearchPlanningError(QUESTION, "invalid_output"); });
  const response = await POST(request(true, false)), reader = response.body!.getReader();
  await started; await reader.cancel(); release();
  await vi.waitFor(() => expect(ledger.calls[0]?.outcome).toBe("failed"));
  // Allow the actual collector/terminal catch to finish after the failed engine.
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(saved).not.toHaveBeenCalled(); expect(boundary.complete).not.toHaveBeenCalled();
});

it.each([false, true])("does not lose the saved failure if private claim completion rejects, stream=%s", async stream => {
  boundary.claim.mockResolvedValue({ complete: boundary.complete }); boundary.complete.mockRejectedValue(Error("PRIVATE_CLAIM_TEXT"));
  const response = await POST(request(stream, false)), wire = await response.text();
  const { error, packet } = failure(response, wire, stream);
  expect(error.reportSaved).toBe(true); expect(packet).toBeUndefined(); expect(saved).toHaveBeenCalledOnce();
  expect(native.prepare("SELECT count(*) n FROM query_runs").get()?.n).toBe(1);
  expect(wire).not.toContain("PRIVATE_CLAIM_TEXT");
});

it.each(["later-phase", "payment-boundary", "save-boundary", "unrelated"] as const)
  ("does not manufacture a zero-spend original after %s", async kind => {
    vi.spyOn(agent, "collectRun").mockImplementation(async (input, options) => {
      options?.onStep?.({ phase: kind === "later-phase" ? "discover" : "decompose", message: "Synthetic boundary", ts: 1 });
      if (kind === "payment-boundary") await input.onCreatorPaymentBoundary?.();
      if (kind === "save-boundary") await input.onQueryRunSaveBoundary?.();
      throw kind === "unrelated" ? Error("PRIVATE_INTERNAL_TEXT") : new ResearchPlanningError(QUESTION, "invalid_output");
    });
    const response = await POST(request(true)), wire = await response.text();
    expect(saved).not.toHaveBeenCalled(); expect(boundary.complete).not.toHaveBeenCalled();
    expect(wire).not.toContain("[DONE]");
  });

it.each([false, true])("retains sponsored admission before dependency/model/report work, stream=%s", async stream => {
  boundary.admission.mockResolvedValue(Response.json({ error: "sponsored_rate_limit" }, { status: 429 }));
  const response = await POST(request(stream)); expect(response.status).toBe(429);
  for (const fn of [boundary.deps, boundary.decompose, saved, boundary.claim, boundary.complete]) expect(fn).not.toHaveBeenCalled();
});
