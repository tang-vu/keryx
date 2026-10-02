import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), terms: vi.fn(), settle: vi.fn(), mainnet: false }));
vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, config: { ...original.config, get networkId() { return mocks.mainnet ? "eip155:5042" : "eip155:5042002"; } } };
});
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/registry/source-fetch-payto", () => ({ sourceFetchTerms: mocks.terms }));
vi.mock("@/lib/x402-server", () => ({ settleThenServe: mocks.settle }));
import { GET, POST, PUT } from "@/app/api/creator/[id]/scholarly/route";
import { POST as cite } from "@/app/api/cite/[id]/route";
import { GET as publicProfile } from "@/app/api/creator/[id]/route";
const creator = "0x1111111111111111111111111111111111111111", other = "0x2222222222222222222222222222222222222222";
const source = { id: "paper", walletAddress: creator, authors: [], active: true, verified: true, onchainId: `0x${"a".repeat(64)}` };
let db: { getSource: ReturnType<typeof vi.fn>; getPaperState?: ReturnType<typeof vi.fn>; submitPaper?: ReturnType<typeof vi.fn>;
  beginPaperEnrollment?: ReturnType<typeof vi.fn>; getItems: ReturnType<typeof vi.fn>; consumeRateLimit: ReturnType<typeof vi.fn> };
const ctx = { params: Promise.resolve({ id: "paper" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mainnet = false;
  db = { getSource: vi.fn().mockResolvedValue(source), getPaperState: vi.fn().mockResolvedValue(null),
    submitPaper: vi.fn(), beginPaperEnrollment: vi.fn(), getItems: vi.fn().mockResolvedValue([]), consumeRateLimit: vi.fn().mockResolvedValue({ allowed: true }) };
  mocks.session.mockResolvedValue({ address: creator }); mocks.db.mockResolvedValue(db);
  mocks.terms.mockResolvedValue({ authority: "onchain", stale: false, active: true, creator, payTo: creator, listPriceUsdc: 0.01 });
});
it("refuses the experimental mainnet rights domain before auth, storage or body processing", async () => {
  mocks.mainnet = true;
  const req = new NextRequest("https://example.test/api/creator/paper/scholarly", { method: "POST", body: "{}" });
  for (const handler of [GET, POST, PUT]) {
    const response = await handler(req, ctx);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ network: "eip155:5042" });
  }
  expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled(); expect(req.bodyUsed).toBe(false);
});
it("authenticates status, draft enrollment and signed submissions before reading their body", async () => {
  mocks.session.mockResolvedValue(null);
  const req = new NextRequest("http://localhost/api/creator/paper/scholarly", { method: "POST", body: "{}" });
  for (const handler of [GET, POST, PUT]) expect((await handler(req, ctx)).status).toBe(401);
  expect(mocks.db).not.toHaveBeenCalled(); expect(req.bodyUsed).toBe(false);
});
it("rejects wrong creator, stale authority and unsupported datastore", async () => {
  mocks.session.mockResolvedValue({ address: other });
  expect((await PUT(new NextRequest("http://localhost"), ctx)).status).toBe(403);
  mocks.session.mockResolvedValue({ address: creator }); mocks.terms.mockResolvedValue({ authority: "onchain", stale: true });
  expect((await GET(new NextRequest("http://localhost"), ctx)).status).toBe(503);
  delete db.getPaperState;
  expect((await PUT(new NextRequest("http://localhost"), ctx)).status).toBe(503);
  expect(db.beginPaperEnrollment).not.toHaveBeenCalled();
});
it("makes an authenticated explicit draft operation before any content exists, with private status", async () => {
  const result = await PUT(new NextRequest("http://localhost", { method: "PUT" }), ctx);
  expect(result.status).toBe(200); expect(db.beginPaperEnrollment).toHaveBeenCalledWith("paper", creator);
  expect(await result.json()).toMatchObject({ status: "draft", earning: false });
  db.getSource.mockResolvedValue({ ...source, scholarlyEnrolled: true });
  const status = await GET(new NextRequest("http://localhost"), ctx);
  expect(status.headers.get("cache-control")).toBe("private, no-store");
  expect(await status.json()).toMatchObject({ state: null, enrolled: true, ready: false });
});
it("bounds streamed body and rate limits before expensive parsing/signature verification", async () => {
  const request = () => new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ padding: "x".repeat(17000) }) });
  expect((await POST(request(), ctx)).status).toBe(400);
  expect(db.submitPaper).not.toHaveBeenCalled();
  db.consumeRateLimit.mockResolvedValue({ allowed: false });
  const limited = request(); expect((await POST(limited, ctx)).status).toBe(429); expect(limited.bodyUsed).toBe(false);
});
it("citation route refuses scholarly draft and corrupt rights before invoking the settlement helper", async () => {
  // No registry id avoids an unrelated live RPC read in this route test; scholarly rights still fail closed.
  db.getSource.mockResolvedValue({ ...source, onchainId: undefined, scholarlyEnrolled: true });
  const request = () => new NextRequest(`http://localhost/api/cite/paper?author=${creator}&amount=0.01`, { method: "POST" });
  expect((await cite(request(), ctx)).status).toBe(409);
  db.getPaperState!.mockRejectedValue(new Error("Private corrupt evidence must not leak"));
  const refused = await cite(request(), ctx); expect(refused.status).toBe(409);
  expect(await refused.text()).not.toContain("Private corrupt"); expect(mocks.settle).not.toHaveBeenCalled();
});
it("public profile whitelists license, dates and safe approval summary without exporting private evidence or contact", async () => {
  const id = `0x${"a".repeat(64)}`;
  db.getPaperState!.mockResolvedValue({ declarationId: id, decisionId: id,
    submission: { declaration: { contentVersion: "ipfs:version1", license: "Public authorized license",
      permissionEvidence: "PRIVATE permission agreement reference", revocationContact: "PRIVATE revocation contact",
      effectiveAt: "2026-10-01T00:00:00Z", embargoUntil: "2026-10-01T00:00:00Z", expiresAt: "2026-10-03T00:00:00Z" } },
    review: { decision: { declarationId: id, outcome: "approved", publicSummary: "Exact manuscript reviewed",
      evidence: "PRIVATE reviewer notes", rationale: "PRIVATE rationale" } } });
  mocks.db.mockResolvedValue({ ...db, listPaymentsBySource: vi.fn().mockResolvedValue([]), creatorLeaderboard: vi.fn().mockResolvedValue([]),
    getSyncState: vi.fn().mockResolvedValue(null) });
  const response = await publicProfile(new NextRequest("http://localhost"), ctx);
  expect(response.status).toBe(200);
  const body = await response.json(); expect(body.scholarlyRights).toMatchObject({ status: "approved", license: "Public authorized license",
    summary: "Exact manuscript reviewed", expiresAt: "2026-10-03T00:00:00Z" });
  expect(JSON.stringify(body)).not.toContain("PRIVATE"); expect(JSON.stringify(body)).not.toContain("permissionEvidence");
});
