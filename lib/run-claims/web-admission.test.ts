import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ deps: vi.fn(), run: vi.fn(), activation: vi.fn(), prepare: vi.fn(), complete: vi.fn(), save: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.deps }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.run }));
vi.mock("@/lib/activation", () => ({ recordActivationEvent: mocks.activation }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
vi.mock("@/lib/run-claims/hosted-delivery", () => ({ hostedRunClaimsEnabled: () => process.env.KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED === "true", prepareHostedRunClaim: mocks.prepare }));
import { POST } from "../../app/api/ask/route";
import { config } from "../config";
import { issuePrivateDocument } from "./web-document";
import { createPrivateClaimHandoff } from "./web-handoff";
const originalSecret = Object.getOwnPropertyDescriptor(config, "jwtSecret")!, originalBaseUrl = Object.getOwnPropertyDescriptor(config, "baseUrl")!;
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue(null); mocks.save.mockResolvedValue(undefined);
  mocks.activation.mockResolvedValue(undefined); mocks.prepare.mockResolvedValue({ complete: mocks.complete });
  Object.defineProperty(config, "jwtSecret", { ...originalSecret, value: "synthetic-document-session-key-1234567890" });
  Object.defineProperty(config, "baseUrl", { ...originalBaseUrl, value: "http://localhost:3939" });
  mocks.deps.mockResolvedValue({ engine: { name: "heuristic" }, gateway: { mode: "offline" }, db: { saveQueryRun: mocks.save } });
  mocks.run.mockImplementation(async function* (options) { return { id: options.queryId, createdAt: new Date().toISOString(), question: options.question,
    budget: 0, answer: "Synthetic completed research", decisions: [], citations: [], trace: [], paymentMode: "offline", totalSpent: 0, totalToCreators: 0 }; });
  mocks.complete.mockImplementation(async run => ({ version: 1, runId: run.id, status: "unavailable" }));
});
afterEach(() => { Object.defineProperty(config, "jwtSecret", originalSecret); Object.defineProperty(config, "baseUrl", originalBaseUrl); });
afterEach(() => vi.unstubAllEnvs());
it("enabled anonymous web cannot start research on an analytics-allowed document without protected-document admission", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true");
  const response = await POST(new NextRequest("https://synthetic.example/api/ask", { method: "POST", body: JSON.stringify({ question: "Synthetic private web", budget: 0 }) }));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "private_research_document_required" });
  expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.activation).not.toHaveBeenCalled();
});
const request = () => new NextRequest(config.baseUrl + "/api/ask", { method: "POST", headers: { Origin: config.baseUrl, "Sec-Fetch-Site": "same-origin",
  "X-Keryx-Private-Document": issuePrivateDocument("n".repeat(43), { origin: config.baseUrl, network: config.networkId }, config.jwtSecret) },
  body: JSON.stringify({ question: "Synthetic private web", budget: 0 }) });
it("admission failure occurs before providers, activation or persistence", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true"); mocks.prepare.mockRejectedValue(new Error("Synthetic unavailable domain"));
  const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "claims_unavailable" });
  expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.activation).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("prepares before research, saves unchanged original before private completion, and sends the separate packet after done", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true");
  const response = await POST(request()), text = await response.text();
  expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.deps.mock.invocationCallOrder[0]);
  expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]);
  const run = mocks.save.mock.calls[0][0]; expect(run).not.toHaveProperty("delivery"); expect(run).not.toHaveProperty("claimUrl");
  expect(run).not.toHaveProperty("asker"); expect(text.indexOf("event: done")).toBeLessThan(text.indexOf("event: private-run-claim"));
  expect(text).toContain("Synthetic completed research"); expect(text).not.toContain("event: error");
  expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});
it("owned completions retain attribution and never prepare an anonymous credential", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true"); mocks.session.mockResolvedValue({ address: "0x" + "a".repeat(40) });
  mocks.deps.mockResolvedValue({ engine: { name: "heuristic" }, gateway: { mode: "offline" }, db: { saveQueryRun: mocks.save, listQueryRunsByAsker: async () => [] } });
  const response = await POST(request()), text = await response.text();
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ asker: "0x" + "a".repeat(40), askerFunded: false });
  expect(text).not.toContain("event: private-run-claim");
});
it("the available web credential is absent from done, persistence and activation arguments", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true");
  const token = "c".repeat(64);
  mocks.complete.mockImplementation(async run => ({ version: 1, runId: run.id, status: "available", delivery: {
    version: 1, claimUrl: config.baseUrl + "/claim-run#" + token, expiresAt: "2030-01-01T00:00:00.000Z",
  } }));
  const text = await (await POST(request())).text();
  const frames = text.split("\n\n").filter(Boolean);
  const privateFrames = frames.filter(frame => frame.startsWith("event: private-run-claim\n"));
  expect(privateFrames).toHaveLength(1); expect(privateFrames[0]).toContain(token);
  expect(frames.filter(frame => !privateFrames.includes(frame)).join("\n")).not.toContain(token);
  expect(JSON.stringify(mocks.save.mock.calls)).not.toContain(token);
  expect(JSON.stringify(mocks.activation.mock.calls)).not.toContain(token);
});
it("a failed web save never completes or emits a private credential", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true"); mocks.save.mockRejectedValue(new Error("Synthetic save failure"));
  const text = await (await POST(request())).text();
  expect(text).toContain("event: error"); expect(text).not.toContain("event: done");
  expect(text).not.toContain("event: private-run-claim"); expect(mocks.complete).not.toHaveBeenCalled();
});

// Controlled handoff failures use the real browser-safe closure, without a browser
// or an alternate auth/storage implementation.
const handoffOrigin = "https://claims.example", handoffRun = "synthetic-handoff", handoffToken = "d".repeat(64);
const handoffRaw = JSON.stringify({ version: 1, runId: handoffRun, status: "available", delivery: { version: 1,
  claimUrl: handoffOrigin + "/claim-run#" + handoffToken, expiresAt: "2030-01-01T00:00:00.000Z" } });
function handoffFixture() {
  let proof: string | null = "original-document", stamp = Date.parse("2029-01-01T00:00:00.000Z");
  const states: string[] = [], open = vi.fn();
  const handoff = createPrivateClaimHandoff({ origin: () => handoffOrigin, documentProof: () => proof, now: () => stamp, open });
  handoff.subscribe(value => states.push(value));
  expect(handoff.begin()).toBe(proof); handoff.saved(handoffRun);
  return { handoff, states, open, proof: (value: string | null) => { proof = value; }, now: (value: number) => { stamp = value; } };
}
it.each(["packet", "finish", "open"] as const)("a replaced document proof cannot release a credential at %s", phase => {
  for (const replacement of [null, "different-document"]) {
    const f = handoffFixture();
    if (phase === "packet") f.proof(replacement);
    f.handoff.packet(handoffRaw);
    if (phase === "finish") f.proof(replacement);
    f.handoff.finish();
    if (phase === "open") f.proof(replacement);
    f.handoff.open(); expect(f.open).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toBe("unavailable"); expect(JSON.stringify([f.states, f.handoff])).not.toContain(handoffToken);
  }
});
it.each(["finish", "open"] as const)("expiry at the exact boundary forgets the credential at %s", phase => {
  const f = handoffFixture(); f.handoff.packet(handoffRaw);
  if (phase === "finish") f.now(Date.parse("2030-01-01T00:00:00.000Z"));
  f.handoff.finish();
  if (phase === "open") f.now(Date.parse("2030-01-01T00:00:00.000Z"));
  f.handoff.open(); expect(f.open).not.toHaveBeenCalled(); expect(f.states.at(-1)).toBe("unavailable");
});
it.each([
  handoffRaw.replace('"runId":', '"runId":"other","runId":'),
  handoffRaw.replace('"claimUrl":', '"claimUrl":"https://foreign.example/claim-run#' + "e".repeat(64) + '","claimUrl":'),
  handoffRaw.replace('"delivery":{', '"delivery":{"token":"' + "e".repeat(64) + '",'),
  handoffRaw.replace('"status":', '"token":"' + "e".repeat(64) + '","status":'),
])("ambiguous or extra secret fields never become an openable packet: %#", raw => {
  const f = handoffFixture(); f.handoff.packet(raw); f.handoff.finish(); f.handoff.open();
  expect(f.open).not.toHaveBeenCalled(); expect(f.states).not.toContain("available");
  expect(JSON.stringify([f.states, f.handoff])).not.toContain(handoffToken);
});
it.each(["packet", "saved"] as const)("a duplicate %s after completion destroys the previously available delivery", kind => {
  const f = handoffFixture(); f.handoff.packet(handoffRaw); f.handoff.finish(); expect(f.states.at(-1)).toBe("available");
  if (kind === "packet") f.handoff.packet(handoffRaw); else f.handoff.saved(handoffRun);
  expect(f.states.at(-1)).toBe("unavailable"); f.handoff.open(); expect(f.open).not.toHaveBeenCalled();
});
it("a thrown private-window open forgets the credential and cannot retry", () => {
  const f = handoffFixture(); f.open.mockImplementation(() => { throw new Error("Synthetic failed open"); });
  f.handoff.packet(handoffRaw); f.handoff.finish(); f.handoff.open(); expect(f.states.at(-1)).toBe("lost");
  f.handoff.open(); expect(f.open).toHaveBeenCalledOnce();
});
