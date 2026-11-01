import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunInput } from "./agent/run-agent";
import type { QueryRun } from "./types";
import type { RunVisibility } from "./run-privacy/contracts";
import { researchPublication } from "./run-privacy/publication";
import { ResearchPlanningError } from "./llm/research-plan";

const mocks = vi.hoisted(() => ({ runAgent: vi.fn(), deps: vi.fn(), save: vi.fn(), resolve: vi.fn(),
  session: vi.fn(), publication: vi.fn(), activation: vi.fn(), admission: vi.fn() }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.deps }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.runAgent }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ runPrivacyActive: true, recordActivationEvent: mocks.activation }) }));
vi.mock("@/lib/history/read-dispatch", () => ({ resolveDispatch: mocks.resolve }));
vi.mock("@/lib/run-privacy/auth", () => ({ privacyBinding: () => "synthetic-follow-up-binding" }));
vi.mock("@/lib/run-privacy/ask-publication", () => ({ prepareAskPublication: mocks.publication }));
vi.mock("@/lib/research-feedback/hosted-delivery", () => ({ hostedRequesterObservations: async () => null }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", checkRateLimit: async () => null }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: mocks.admission }));
vi.mock("@/lib/research/availability", () => ({ readResearchAvailability: () => ({ state: "open" }) }));
vi.mock("@/lib/config", () => ({ config: { profile: { name: "arcTestnet", networkId: "synthetic" },
  networkId: "synthetic", baseUrl: "https://keryx.invalid", defaultBudget: 0.02,
  anonMaxBudget: 0.05, sessionAskMaxBudget: 0.25, botKey: "", devWallets: [] } }));

import { POST } from "@/app/api/ask/route";

const wallet = "0x1111111111111111111111111111111111111111";
const paidAnswer = "PAID_PARENT_ANSWER_MUST_NOT_ENTER_RESEARCH_INPUT";
const original = "How would you make an email-sending job safe to retry? I found this page but I'm not sure how to apply it: https://docs.bullmq.io/patterns/idempotent-jobs";
const questions = [
  "What if the provider accepts the email, then the worker crashes before saving that it was sent?",
  "Suppose that provider doesn't support idempotency keys. How should I handle an attempt when I don't know whether it sent the email?",
  "What would you store in the database so the next worker can make that decision safely?",
];
type Record = { run: QueryRun; visibility: RunVisibility; owner: string };
const saved = new Map<string, Record>();
function run(id: string, question: string, parentId?: string): QueryRun {
  return { id, question, budget: 0, engine: "synthetic-offline", subClaims: [], decisions: [], citations: [],
    answer: paidAnswer, totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-11-01T00:00:00.000Z",
    ...(parentId ? { parentId } : {}) };
}
function events(wire: string) {
  return wire.split("\n\n").filter(part => /^event:/m.test(part)).map(part => ({
    event: /^event: (.+)$/m.exec(part)![1], data: JSON.parse(/^data: (.+)$/m.exec(part)![1]),
  }));
}
async function ask(question: string, parentId?: string, extra: object = {}) {
  const response = await POST(new NextRequest("https://keryx.invalid/api/ask", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ question, parentId, budget: 0, ...extra }) }));
  const wire = await response.text();
  return { response, wire, packets: response.headers.get("content-type")?.includes("event-stream") ? events(wire) : [] };
}
beforeEach(() => {
  vi.clearAllMocks(); saved.clear();
  saved.set("root", { run: run("root", original), visibility: "public", owner: wallet });
  mocks.session.mockResolvedValue({ address: wallet }); mocks.activation.mockResolvedValue(undefined); mocks.admission.mockResolvedValue(null);
  mocks.resolve.mockImplementation(async (id: string, _db: unknown, actor?: { wallet: string }) => {
    const row = saved.get(id);
    if (!row || row.visibility === "private" && actor?.wallet !== row.owner) return null;
    return { run: row.run, visibility: row.visibility };
  });
  mocks.publication.mockImplementation(async (_req: Request, requested: unknown, asker?: string, parentVisibility?: RunVisibility) => ({
    visibility: researchPublication({ requested, parentVisibility, privacyActive: true, hasOwner: !!asker }), privacyActive: true,
  }));
  mocks.save.mockImplementation(async (value: QueryRun, options?: { visibility: RunVisibility }) => {
    saved.set(value.id, { run: JSON.parse(JSON.stringify(value)), visibility: options?.visibility ?? "public", owner: wallet });
  });
  mocks.deps.mockResolvedValue({ db: { saveQueryRun: mocks.save, listQueryRunsByAsker: async () => [], recordActivationEvent: mocks.activation },
    engine: { name: "synthetic-offline" }, gateway: { mode: "offline" } });
  mocks.runAgent.mockImplementation(async function* (input: RunInput) {
    yield { phase: "decompose", message: `Breaking down: ${input.question}`, ts: 1 };
    return run(input.queryId!, input.question);
  });
});

describe("actual web follow-up context and stored caller questions", () => {
  it("keeps all three email-job turns flat in history and preserves the no-idempotency/unknown-send condition", async () => {
    let parentId = "root";
    const returned: QueryRun[] = [];
    for (const question of questions) {
      const result = await ask(question, parentId);
      expect(result.response.status).toBe(200);
      const done = result.packets.find(packet => packet.event === "done")?.data as QueryRun;
      expect(done).toBeDefined(); expect(done.parentId).toBe(parentId); expect(done.asker).toBe(wallet);
      expect(done.totalSpent).toBe(0); expect(done.totalToCreators).toBe(0);
      returned.push(done); parentId = done.id;
    }
    const inputs = mocks.runAgent.mock.calls.map(call => call[0] as RunInput);
    expect(inputs[2].question).toContain(questions[1]);
    expect(inputs[2].question).toContain(questions[0]);
    expect(inputs[2].question).toContain(original);
    expect(inputs.map(input => input.originalQuestion)).toEqual(questions);
    expect(returned.map(value => value.question)).toEqual(questions);
    expect(mocks.save.mock.calls.map(call => call[0].question)).toEqual(questions);
    expect(inputs.every(input => !input.question.includes(paidAnswer))).toBe(true);
  });

  it("a later short reference still carries the earlier conditions rather than only the latest vague question", async () => {
    let parentId = "root";
    for (const question of [...questions, "Would that still prevent a duplicate send?"]) {
      const result = await ask(question, parentId);
      parentId = result.packets.find(packet => packet.event === "done")!.data.id;
    }
    expect(mocks.runAgent.mock.calls[3][0].question).toContain(questions[1]);
    expect(mocks.runAgent.mock.calls[3][0].question).toContain(questions[0]);
    expect(mocks.save.mock.calls[3][0].question).toBe("Would that still prevent a duplicate send?");
  });

  it("uses the most restrictive included ancestor visibility before any inference", async () => {
    saved.set("root", { run: run("root", "Private owner condition"), visibility: "private", owner: wallet });
    saved.set("public-child", { run: run("public-child", "A public referring question", "root"), visibility: "public", owner: wallet });
    const result = await ask("What about that decision?", "public-child", { visibility: "public" });
    expect(result.response.status).toBe(409);
    expect(result.wire).toContain("parent_visibility_conflict");
    expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.runAgent).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("does not expose a different owner's private ancestor", async () => {
    saved.set("root", { run: run("root", "OTHER_OWNER_PRIVATE_CONDITION"), visibility: "private", owner: "0x2222222222222222222222222222222222222222" });
    saved.set("public-child", { run: run("public-child", "Public referring question", "root"), visibility: "public", owner: wallet });
    const result = await ask("How would that work?", "public-child");
    expect(result.response.status).toBe(200);
    expect(mocks.runAgent.mock.calls[0][0].question).not.toContain("OTHER_OWNER_PRIVATE_CONDITION");
    expect(result.wire).not.toContain("OTHER_OWNER_PRIVATE_CONDITION");
    expect(mocks.resolve.mock.calls.every(call => call[2]?.wallet === wallet)).toBe(true);
  });

  it("an admission refusal performs only the existing immediate-parent read, with no older ancestry or inference", async () => {
    saved.set("public-child", { run: run("public-child", "Latest referring question", "root"), visibility: "public", owner: wallet });
    mocks.admission.mockResolvedValue(Response.json({ error: "synthetic_rate_limit" }, { status: 429 }));
    const result = await ask("How would that work?", "public-child");
    expect(result.response.status).toBe(429);
    expect(mocks.resolve.mock.calls.map(call => call[0])).toEqual(["public-child"]);
    expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.runAgent).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("unknown or inaccessible immediate parents retain the validated standalone input", async () => {
    const result = await ask("  Explain this without a hidden parent's data.  ", "missing", { originalQuestion: "spoofed input" });
    const input = mocks.runAgent.mock.calls[0][0] as RunInput;
    expect(input.question).toBe("Explain this without a hidden parent's data."); expect(input.originalQuestion).toBe(input.question);
    expect(result.packets.find(packet => packet.event === "done")!.data.parentId).toBeUndefined();
  });

  it("planning refusal stores the raw follow-up with its existing owner/parent and zero payment state", async () => {
    mocks.runAgent.mockImplementation(async function* () {
      yield { phase: "decompose", message: "Synthetic planning refusal", ts: 1 };
      throw new ResearchPlanningError("synthetic", "invalid_output");
    });
    const result = await ask(questions[2], "root");
    expect(result.packets.find(packet => packet.event === "error")!.data.reportSaved).toBe(true);
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ question: questions[2], parentId: "root", asker: wallet,
      totalSpent: 0, totalToCreators: 0, paymentMode: "offline" });
    expect(result.packets.some(packet => packet.event === "done")).toBe(false);
  });
});
