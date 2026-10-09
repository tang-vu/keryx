import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runAgent: vi.fn(), collectRun: vi.fn(), getAgentDeps: vi.fn(),
  saveQueryRun: vi.fn(), recordActivationEvent: vi.fn(), pay: vi.fn(), payCitation: vi.fn() }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.getAgentDeps, collectRun: mocks.collectRun }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.runAgent }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(async () => ({ saveQueryRun: mocks.saveQueryRun, recordActivationEvent: mocks.recordActivationEvent })) }));
vi.mock("@/lib/llm", () => ({ resolveModelChoice: vi.fn(() => undefined) }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: vi.fn(async () => null) }));
vi.mock("@/lib/config", async () => {
  const { ARC_MAINNET_PROFILE } = await import("../arc-network-profile");
  return { config: { profile: ARC_MAINNET_PROFILE, sellerAddress: "0x1111111111111111111111111111111111111111",
    baseUrl: "https://keryx.invalid", defaultBudget: 0.02, anonMaxBudget: 0.05, a2aMaxBudget: 0.1,
    sessionAskMaxBudget: 0.25, botKey: "" } };
});

import { POST as ask } from "@/app/api/ask/route";
import { POST as completion } from "@/app/api/v1/chat/completions/route";
import { createRemoteMcpServer } from "../mcp/remote-server";
import { ResearchSelectionError } from "../llm/research-selection";
import type { SelectionDiagnostic } from "./selection-diagnostic";
import { researchFailureMessage } from "../llm/research-plan";
import { selectionFailureExport } from "./selection-failure-export";
import { SQLITE_SELECTION_QUESTION } from "../../test-support/sqlite-selection-fixture";

const diagnostic: SelectionDiagnostic = { protocol: "keryx-source-selection-v1",
  id: "c12f7f67-2208-4f9d-ab28-f136ae55e61d", createdAt: "2026-10-05T00:00:00.000Z",
  stage: "decide", outcome: "refused", counts: { candidateCount: 2, targetCount: 8,
    decisionCount: 2, matchedCandidateCount: 2, validActionableCount: 0, withheldCandidateCount: 2, invalidRowCount: 2 },
  reasons: [{ code: "missing_targets", rowIndex: 0, candidateIndex: 0 },
    { code: "target_out_of_range", rowIndex: 1, candidateIndex: 1 }], truncated: false };

function request(path: string, body: object) {
  return new NextRequest(`https://keryx.invalid${path}`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function completionRequest(stream: boolean) {
  return request("/api/v1/chat/completions", { model: "keryx", messages: [{ role: "user", content: SQLITE_SELECTION_QUESTION }], budget: 0, stream });
}
beforeEach(() => {
  vi.clearAllMocks();
  const error = new ResearchSelectionError(diagnostic, 2048);
  mocks.getAgentDeps.mockResolvedValue({ db: { saveQueryRun: mocks.saveQueryRun, recordActivationEvent: mocks.recordActivationEvent },
    engine: { name: "synthetic-selection" }, gateway: { mode: "offline", pay: mocks.pay, payCitation: mocks.payCitation } });
  mocks.recordActivationEvent.mockResolvedValue(undefined);
  mocks.collectRun.mockRejectedValue(error);
  mocks.runAgent.mockImplementation(async function* () {
    yield { phase: "decide", message: "Source selection refused", detail: diagnostic, ts: 1 };
    throw error;
  });
});

describe("terminal source-selection failure on hosted callers", () => {
  it("web preserves a classified diagnostic without creating a completed dispatch or payment receipt", async () => {
    const response = await ask(request("/api/ask", { question: SQLITE_SELECTION_QUESTION, budget: 0 }));
    expect(response.status).toBe(200);
    const wire = await response.text();
    const packets = wire.trim().split("\n\n").map(packet => ({ event: /^event: (.+)$/m.exec(packet)?.[1],
      data: JSON.parse(/^data: (.+)$/m.exec(packet)![1]) }));
    expect(packets.map(packet => packet.event)).toEqual(["meta", "step", "error"]);
    expect(packets[2].data).toEqual({ message: expect.any(String), code: "research_source_selection_invalid", selectionDiagnostic: diagnostic });
    expect(packets[2].data.message).toContain("2,048-token output limit");
    expect(packets[2].data.message).not.toMatch(/503|saved evidence/);
    expect(mocks.runAgent).toHaveBeenCalledOnce();
    expect(mocks.runAgent.mock.calls[0][0].question).toBe(SQLITE_SELECTION_QUESTION);
    expect(mocks.saveQueryRun).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled(); expect(mocks.payCitation).not.toHaveBeenCalled();
    expect(wire).not.toContain("event: done");
  });

  it("OpenAI JSON returns 422 and a machine-readable diagnostic while preserving the original request", async () => {
    const response = await completion(completionRequest(false));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { message: expect.stringContaining("2,048-token output limit"), type: "invalid_request_error",
      code: "research_source_selection_invalid", selectionDiagnostic: diagnostic } });
    expect(mocks.collectRun).toHaveBeenCalledOnce();
    expect(mocks.collectRun.mock.calls[0][0].question).toBe(SQLITE_SELECTION_QUESTION);
    expect(mocks.saveQueryRun).not.toHaveBeenCalled();
  });

  it("OpenAI started streams attach error diagnostics without completion metadata or DONE", async () => {
    const completionId = "f6260338-7445-4d3e-ab3c-5030719b21e0";
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(completionId);
    try {
      const response = await completion(completionRequest(true));
      expect(response.status).toBe(200);
      const wire = await response.text();
      const packets = wire.trim().split("\n\n").map(packet => JSON.parse(/^data: (.+)$/m.exec(packet)![1]));
      expect(packets.every(packet => packet.id === `chatcmpl-${completionId}`)).toBe(true);
      expect(packets.at(-1).keryx_error).toEqual({ code: "research_source_selection_invalid", selectionDiagnostic: diagnostic });
      expect(packets.every(packet => packet.choices[0].finish_reason === null && packet.keryx === undefined)).toBe(true);
      expect(wire).not.toContain("data: [DONE]");
      const content = packets.map(packet => packet.choices[0].delta.content ?? "").join("");
      expect(content).toContain("2,048-token output limit");
      expect(content).not.toMatch(/503|saved evidence/);
      expect(mocks.collectRun).toHaveBeenCalledOnce();
    } finally { uuid.mockRestore(); }
  });

  it("remote MCP retains isError plus exportable diagnostic text without a completed result", async () => {
    const server = createRemoteMcpServer({ budgetCap: 0.03, clientChannel: "other" });
    const client = new Client({ name: "selection-failure-fixture", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const result = await client.callTool({ name: "research", arguments: { question: SQLITE_SELECTION_QUESTION, budget: 0 } });
      expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
      const content = result.content as { type: string; text: string }[];
      expect(content).toHaveLength(2);
      expect(content[0].text).toContain("Keryx research failed:");
      expect(content[0].text).toContain("2,048-token output limit");
      expect(content[0].text).not.toMatch(/503|saved evidence/);
      expect(JSON.parse(content[1].text.split("\n")[1])).toEqual(diagnostic);
      expect(mocks.collectRun).toHaveBeenCalledOnce();
      expect(mocks.collectRun.mock.calls[0][0].question).toBe(SQLITE_SELECTION_QUESTION);
    } finally { await client.close(); await server.close(); }
  });
});

describe("failure diagnostic export", () => {
  it("keeps only allowlisted diagnostics, never question/provider payload/receipt claims", () => {
    const artifact = selectionFailureExport({ ...diagnostic, providerPayload: "PRIVATE_OUTPUT", sourceUrl: "https://private.invalid/?credential=secret" })!;
    expect(JSON.parse(artifact.text).selectionDiagnostic).toEqual(diagnostic);
    expect(artifact.text).not.toContain("PRIVATE_OUTPUT"); expect(artifact.text).not.toContain("private.invalid");
    expect(artifact.filename).toContain(diagnostic.id);
    expect(researchFailureMessage(new ResearchSelectionError(diagnostic))).toContain("missing_targets");
  });
  it("does not turn partial validation or invalid metadata into a failure artifact", () => {
    expect(selectionFailureExport({ ...diagnostic, outcome: "partial" })).toBeUndefined();
    expect(selectionFailureExport({ ...diagnostic, id: "../../untrusted" })).toBeUndefined();
    expect(selectionFailureExport(undefined)).toBeUndefined();
  });
});
