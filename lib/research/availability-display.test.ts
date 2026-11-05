import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admission: vi.fn(() => true), display: vi.fn(() => false), deps: vi.fn(), run: vi.fn(), db: vi.fn(), quota: vi.fn() }));
vi.mock("../business-operator/canary-policy", () => ({ canaryExecutionPaused: mocks.admission,
  canaryResearchPaused: mocks.admission, canaryResearchPausedForDisplay: mocks.display }));
vi.mock("../agent", () => ({ getAgentDeps: mocks.deps, collectRun: mocks.run }));
vi.mock("../agent/run-agent", () => ({ runAgent: mocks.run }));
vi.mock("../db", () => ({ getDb: mocks.db }));
vi.mock("../sponsored-admission", () => ({ checkSponsoredResearchAdmission: mocks.quota }));
import { GET, runtime, dynamic } from "../../app/api/research/availability/route";
import { POST as ask } from "../../app/api/ask/route";
import { POST as openai } from "../../app/api/v1/chat/completions/route";
import { POST as mcp } from "../../app/mcp/route";
import { assertOrdinaryResearchAvailable, readResearchAvailability, readResearchAvailabilityForDisplay } from "./availability";
import { parseResearchAvailability, ResearchAdmissionHeldError, RESEARCH_PAUSED_MESSAGE } from "./availability-contract";
const request = (path: string, body: unknown) => new NextRequest(`https://keryx.test${path}`, { method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.admission.mockReturnValue(true); mocks.display.mockReturnValue(false); });

describe("public availability display is separate from admission", () => {
  it.each([false, true])("retains the exact public JSON, no-store and Node route contract (paused=%s)", async paused => {
    mocks.display.mockReturnValue(paused);
    const response = GET();
    expect(await response.json()).toEqual(parseResearchAvailability({ state: paused ? "paused" : "not-paused" }));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runtime).toBe("nodejs"); expect(dynamic).toBe("force-dynamic");
    expect(mocks.display).toHaveBeenCalledOnce(); expect(mocks.admission).not.toHaveBeenCalled();
    for (const sideEffect of [mocks.deps, mocks.run, mocks.db, mocks.quota]) expect(sideEffect).not.toHaveBeenCalled();
  });
  it("retains the old metadata and assertion functions as fresh authoritative observers", () => {
    expect(readResearchAvailabilityForDisplay().state).toBe("not-paused");
    expect(readResearchAvailability().state).toBe("paused");
    expect(() => assertOrdinaryResearchAvailable()).toThrow(ResearchAdmissionHeldError);
    expect(mocks.admission).toHaveBeenCalledTimes(2); expect(mocks.display).toHaveBeenCalledOnce();
  });
  it.each(["ask", "openai", "mcp"])("a stale clear display cannot admit a %s request", async surface => {
    expect((await GET().json()).state).toBe("not-paused");
    const response = surface === "ask"
      ? await ask(request("/api/ask", { question: "Read official SQLite documentation", budget: 0 }))
      : surface === "openai"
        ? await openai(request("/api/v1/chat/completions", { budget: 0, messages: [{ role: "user", content: "Read official SQLite documentation" }] }))
        : await mcp(request("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "research", arguments: { question: "Read official SQLite documentation", budget: 0 } } }));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).toContain(RESEARCH_PAUSED_MESSAGE);
    expect(mocks.admission).toHaveBeenCalled(); expect(mocks.display).toHaveBeenCalledOnce();
    for (const sideEffect of [mocks.deps, mocks.run, mocks.db, mocks.quota]) expect(sideEffect).not.toHaveBeenCalled();
  });
});
