import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), deps: vi.fn(), run: vi.fn(), save: vi.fn(), defaults: vi.fn(), complete: vi.fn(), activation: vi.fn(), db: vi.fn() }));
vi.mock("./auth", () => ({ getSession: mocks.session }));
vi.mock("./agent", () => ({ getAgentDeps: mocks.deps }));
vi.mock("./agent/run-agent", () => ({ runAgent: mocks.run }));
vi.mock("./db", () => ({ getDb: mocks.db }));
vi.mock("./activation", () => ({ recordActivationEvent: mocks.activation }));
vi.mock("./sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
vi.mock("./research/availability", () => ({ readResearchAvailability: () => ({ state: "not-paused" }) }));
vi.mock("./run-claims/hosted-delivery", () => ({ hostedRunClaimsEnabled: () => true,
  prepareHostedRunClaim: async () => ({ complete: mocks.complete }) }));
vi.mock("./config", () => ({ config: { baseUrl: "https://synthetic.example", networkId: "eip155:5042002",
  profile: { name: "arcTestnet", networkId: "eip155:5042002" }, botKey: "", defaultBudget: 0,
  anonMaxBudget: 0.02, sessionAskMaxBudget: 0.05, jwtSecret: "synthetic-document-key-123456789012345" } }));
import { POST } from "../app/api/ask/route";
import { GET as readDispatch } from "../app/api/dispatch/[id]/route";
import { issuePrivateDocument, PRIVATE_DOCUMENT_HEADER } from "./run-claims/web-document";
import { config } from "./config";
import { ResearchPlanningError } from "./llm/research-plan";
import { DatabaseSync } from "node:sqlite";
import { installSqliteApplicationSchema } from "./db/sqlite-application-schema";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "./db/run-privacy-sqlite";
import { writeSqliteQueryRun } from "./db/query-run-record";
import type { QueryRun } from "./types";
import type { RunVisibility } from "./run-privacy/contracts";

const owner = `0x${"a".repeat(40)}`;
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue(null); mocks.defaults.mockResolvedValue("public");
  mocks.save.mockResolvedValue(undefined);
  mocks.db.mockResolvedValue({ runPrivacyActive: true, runPrivacy: { defaults: mocks.defaults, creationReady: async () => {} } });
  mocks.deps.mockResolvedValue({ engine: { name: "synthetic" }, gateway: { mode: "offline" },
    db: { saveQueryRun: mocks.save, listQueryRunsByAsker: async () => [] } });
  mocks.run.mockImplementation(async function* (input) { return { id: input.queryId, question: input.originalQuestion ?? input.question,
    answer: "Synthetic answer", budget: 0, engine: "synthetic", totalSpent: 0, totalToCreators: 0,
    subClaims: [], citations: [], decisions: [], trace: [] }; });
  mocks.complete.mockResolvedValue({ status: "unavailable" });
});
function request(visibility?: string, headers: Record<string, string> = {}) {
  return new NextRequest("https://synthetic.example/api/ask", { method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ question: "Synthetic original", budget: 0, ...(visibility ? { visibility } : {}) }) });
}
function frames(text: string) {
  return text.split("\n\n").filter(frame => frame.startsWith("event:")).map(frame => ({
    event: frame.split("\n")[0].slice(7), data: JSON.parse(frame.split("\n")[1].slice(6)),
  }));
}
it.each(["public", "unlisted"])("binds the early %s report reference to the same saved result", async visibility => {
  const response = await POST(request(visibility));
  const text = await response.text(), events = frames(text);
  expect(text.startsWith(": connected\n\n")).toBe(true);
  const meta = events.find(frame => frame.event === "meta")!.data;
  const done = events.find(frame => frame.event === "done")!.data;
  expect(meta).toMatchObject({ reportId: done.id, visibility });
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: meta.reportId }), { visibility });
});
it("does not disclose a link-readable recovery reference for private owner research", async () => {
  mocks.session.mockResolvedValue({ address: owner });
  const events = frames(await (await POST(request("private"))).text());
  expect(events.find(frame => frame.event === "meta")!.data).not.toHaveProperty("reportId");
});
it("does not expose a public recovery reference on the anonymous private-claim transport", async () => {
  const proof = issuePrivateDocument("n".repeat(43), { origin: config.baseUrl, network: config.networkId }, config.jwtSecret);
  const events = frames(await (await POST(request(undefined, { Origin: config.baseUrl, "Sec-Fetch-Site": "same-origin", [PRIVATE_DOCUMENT_HEADER]: proof }))).text());
  expect(events.find(frame => frame.event === "meta")!.data).not.toHaveProperty("reportId");
});

it.each(["public", "unlisted", "private"])("saves a planning failure under its original %s identity without reporting a completed answer", async visibility => {
  if (visibility === "private") mocks.session.mockResolvedValue({ address: owner });
  mocks.run.mockImplementation(async function* () {
    yield { phase: "decompose", message: "Preparing a bounded plan", ts: 1 };
    throw new ResearchPlanningError("Synthetic original", "needs_refinement");
  });
  const events = frames(await (await POST(request(visibility))).text());
  const meta = events.find(frame => frame.event === "meta")!.data;
  const error = events.find(frame => frame.event === "error")!.data;
  expect(error).toMatchObject({ code: "research_plan_refinement_required", reportSaved: true,
    planningFailure: { version: 1, stage: "decompose", reason: "needs_refinement", maximumTargets: 8 } });
  expect(events.some(frame => frame.event === "done")).toBe(false);
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    id: visibility === "private" ? expect.any(String) : meta.reportId, question: "Synthetic original",
    planningFailure: error.planningFailure, subClaims: [], citations: [], evidence: [], totalSpent: 0,
    totalToCreators: 0, ...(visibility === "private" ? { asker: owner, askerFunded: false } : {}),
  }), { visibility });
  expect(error).not.toHaveProperty("reportId");
  expect(mocks.activation.mock.calls.map(([, event]) => event)).not.toContain("reader_answer_completed");
});

it("keeps an anonymous failed report claim caller-private and separate from the failed original", async () => {
  mocks.run.mockImplementation(async function* () { throw new ResearchPlanningError("Synthetic original", "invalid_output"); });
  mocks.complete.mockImplementation(async run => ({ version: 1, status: "available", runId: run.id,
    delivery: { version: 1, claimUrl: "https://synthetic.example/claim-run#" + "a".repeat(64), expiresAt: "2026-10-20T00:00:00.000Z" } }));
  const proof = issuePrivateDocument("n".repeat(43), { origin: config.baseUrl, network: config.networkId }, config.jwtSecret);
  const events = frames(await (await POST(request("public", { Origin: config.baseUrl, "Sec-Fetch-Site": "same-origin", [PRIVATE_DOCUMENT_HEADER]: proof }))).text());
  const failure = events.find(frame => frame.event === "error")!.data;
  expect(failure).toMatchObject({ reportSaved: true, failedReportId: expect.any(String) });
  expect(events.find(frame => frame.event === "meta")!.data).not.toHaveProperty("reportId");
  expect(events.at(-1)).toMatchObject({ event: "private-run-claim", data: { runId: failure.failedReportId, status: "available" } });
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(mocks.save.mock.calls[0][0]);
  expect(JSON.stringify(mocks.save.mock.calls)).not.toContain("claim-run#");
  expect(events.some(frame => frame.event === "done")).toBe(false);
});

it("does not claim persistence or mint a private claim after a failed save", async () => {
  mocks.run.mockImplementation(async function* () { throw new ResearchPlanningError("Synthetic original", "invalid_output"); });
  mocks.save.mockRejectedValue(new Error("PRIVATE_DB_MESSAGE"));
  const events = frames(await (await POST(request())).text());
  expect(events.at(-1)!.data).toMatchObject({ reportSaved: false, planningFailure: { reason: "invalid_output" } });
  expect(JSON.stringify(events)).not.toContain("PRIVATE_DB_MESSAGE");
  expect(mocks.complete).not.toHaveBeenCalled();
});

it.each(["private", "public", "unlisted"] as const)("serves a saved %s failure from the real permalink API with genuine SQLite privacy", async visibility => {
  const db = new DatabaseSync(":memory:");
  try {
    installSqliteApplicationSchema(db); db.exec(RUN_PRIVACY_SQL);
    const store = createSqliteRunPrivacy(db), binding = { network: "eip155:5042002" as const, origin: "https://synthetic.example" };
    mocks.db.mockResolvedValue({ runPrivacyActive: true, runPrivacy: store });
    mocks.session.mockResolvedValue({ address: owner });
    mocks.save.mockImplementation(async (run: QueryRun, publication: { visibility: RunVisibility }) =>
      writeSqliteQueryRun(db, run, true, { publication, privacy: { runPrivacyActive: true, runPrivacy: store }, enrolled: false }));
    mocks.run.mockImplementation(async function* () { throw new ResearchPlanningError("Synthetic original", "invalid_output"); });
    const events = frames(await (await POST(request(visibility))).text());
    expect(events.at(-1)!.data.reportSaved).toBe(true);
    const run = mocks.save.mock.calls[0][0] as QueryRun;
    const read = () => readDispatch(new NextRequest(`https://synthetic.example/api/dispatch/${run.id}`), { params: Promise.resolve({ id: run.id }) });
    mocks.session.mockResolvedValue(null);
    expect((await read()).status).toBe(visibility === "private" ? 404 : 200);
    mocks.session.mockResolvedValue({ address: `0x${"b".repeat(40)}` });
    expect((await read()).status).toBe(visibility === "private" ? 404 : 200);
    mocks.session.mockResolvedValue({ address: owner });
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization, X-Keryx-Expected-Wallet");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.json()).toMatchObject({ id: run.id, question: "Synthetic original", planningFailure: { reason: "invalid_output" } });
    expect((await store.read(run.id, { wallet: owner, binding })).item).toMatchObject({ run: {
      question: "Synthetic original", planningFailure: { reason: "invalid_output" }, totalSpent: 0, citations: [], evidence: [],
    }, state: { visibility } });
    expect(db.prepare("SELECT count(*) n FROM payment_events").get()?.n).toBe(0);
  } finally { db.close(); }
});

it.each(["cancelled", "after-discovery", "unrelated"])("does not invent a failed zero-spend original for %s errors", async kind => {
  const controller = new AbortController();
  mocks.run.mockImplementation(async function* () {
    if (kind === "after-discovery") yield { phase: "discover", message: "Beyond planning", ts: 1 };
    if (kind === "cancelled") controller.abort();
    if (kind === "unrelated") throw new Error("Controlled transport unavailable");
    throw new ResearchPlanningError("Synthetic original", "invalid_output");
  });
  const response = await POST(new NextRequest("https://synthetic.example/api/ask", { method: "POST", signal: controller.signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "Synthetic original", budget: 0 }) }));
  await response.text();
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled();
});
