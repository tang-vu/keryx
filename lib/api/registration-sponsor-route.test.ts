import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: null as null | { address: string }, ctx: null as unknown, db: {},
  prepare: vi.fn(), submit: vi.fn(), recover: vi.fn() }));
vi.mock("../auth", () => ({ getSession: async () => mocks.session }));
vi.mock("../db", () => ({ getDb: async () => mocks.db }));
vi.mock("../config", () => ({ config: { baseUrl: "https://keryx.example" } }));
vi.mock("../sources/registration-sponsor-runtime", () => ({ registrationSponsorRuntime: async () => mocks.ctx, registrationSponsorReadChain: () => ({}) }));
vi.mock("../sources/registration-sponsor-service", () => ({ prepareSponsoredRegistration: mocks.prepare, submitSponsoredRegistration: mocks.submit, recoverSponsoredRegistration: mocks.recover }));
import { GET, POST } from "../../app/api/sources/sponsor/route";
const wallet = `0x${"11".repeat(20)}`, id = `0x${"aa".repeat(32)}`, signature = `0x${"bb".repeat(65)}`;
const request = (value: unknown, origin = "https://keryx.example", url = "https://keryx.example/api/sources/sponsor") => new Request(url, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Authorization: "Bearer API-key-is-not-owner-authority" }, body: JSON.stringify(value) });
afterEach(() => { mocks.session = null; mocks.ctx = null; mocks.db = {}; vi.clearAllMocks(); });
it("keeps absent policy disabled without admitting an action", async () => {
  expect(await (await GET(new Request("https://keryx.example/api/sources/sponsor"))).json()).toEqual({ available: false });
  mocks.session = { address: wallet };
  expect((await POST(request({ operation: "prepare", claimId: "ab".repeat(32), fetchPrice: 0.016 }))).status).toBe(503);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it.each(["https://foreign.example", "null", ""])("refuses caller Origin %s before any sponsor action", async origin => {
  mocks.session = { address: wallet }; mocks.ctx = {};
  expect((await POST(request({ operation: "submit", id, signature }, origin))).status).toBe(403);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("requires the request URL to match the configured origin too", async () => {
  mocks.session = { address: wallet }; mocks.ctx = {};
  expect((await POST(request({ operation: "submit", id, signature }, "https://keryx.example", "https://foreign.example/api/sources/sponsor"))).status).toBe(403);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("never grants registration ownership to an API key without SIWE", async () => {
  mocks.ctx = {};
  expect((await POST(request({ operation: "submit", id, signature }))).status).toBe(401);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it.each(["wallet", "params", "policy", "receipt", "transactionHash"])("rejects caller-provided %s override", async field => {
  mocks.session = { address: wallet }; mocks.ctx = {};
  expect((await POST(request({ operation: "submit", id, signature, [field]: {} }))).status).toBe(400);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("uses only the authenticated creator and explicit original ID for submission", async () => {
  mocks.session = { address: wallet }; mocks.ctx = {}; mocks.submit.mockResolvedValue({ id, state: "submitted" });
  const response = await POST(request({ operation: "submit", id, signature }));
  expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.submit).toHaveBeenCalledWith(mocks.ctx, wallet, id, signature);
});
it("recovers an original while the policy/key is absent without invoking submission", async () => {
  mocks.session = { address: wallet }; mocks.db = { getRegistrationSponsor: vi.fn(async () => ({ id, state: "submitted" })) };
  mocks.recover.mockResolvedValue({ id, state: "confirmed" });
  const response = await GET(new Request(`https://keryx.example/api/sources/sponsor?id=${id}`));
  expect(await response.json()).toEqual({ original: { id, state: "confirmed" } });
  expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
});
it("returns retained uncertainty when original chain inspection is unavailable", async () => {
  mocks.session = { address: wallet }; mocks.db = { getRegistrationSponsor: vi.fn(async () => ({ id, state: "submitted" })) };
  mocks.recover.mockRejectedValue(new Error("private RPC transport"));
  const response = await GET(new Request(`https://keryx.example/api/sources/sponsor?id=${id}`));
  expect(await response.json()).toEqual({ original: { id, state: "submitted" }, recoveryUnavailable: true });
});
