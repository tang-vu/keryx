import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: null as null | { address: string }, ctx: null as unknown, db: {},
  prepare: vi.fn(), submit: vi.fn(), recover: vi.fn(), resume: vi.fn(), resolveExpired: vi.fn(), inspectFunding: vi.fn(), runtimeError: null as Error | null }));
vi.mock("../auth", () => ({ getSession: async () => mocks.session }));
vi.mock("../db", () => ({ getDb: async () => mocks.db }));
vi.mock("../config", () => ({ config: { baseUrl: "https://keryx.example" } }));
vi.mock("../sources/registration-sponsor-runtime", () => ({ registrationSponsorRuntime: async () => { if (mocks.runtimeError) throw mocks.runtimeError; return mocks.ctx; }, registrationSponsorReadChain: () => ({}) }));
vi.mock("../sources/registration-sponsor-service", () => ({ inspectSponsoredRegistrationFunding: mocks.inspectFunding, prepareSponsoredRegistration: mocks.prepare, submitSponsoredRegistration: mocks.submit, recoverSponsoredRegistration: mocks.recover, resumeSponsoredRegistration: mocks.resume, resolveExpiredSponsoredRegistration: mocks.resolveExpired }));
import { GET, POST } from "../../app/api/sources/sponsor/route";
import { RegistrationSponsorError } from "../db/registration-sponsor";
const wallet = `0x${"11".repeat(20)}`, id = `0x${"aa".repeat(32)}`, signature = `0x${"bb".repeat(65)}`;
const request = (value: unknown, origin = "https://keryx.example", url = "https://keryx.example/api/sources/sponsor") => new Request(url, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Authorization: "Bearer API-key-is-not-owner-authority" }, body: JSON.stringify(value) });
afterEach(() => { mocks.session = null; mocks.ctx = null; mocks.db = {}; mocks.runtimeError = null; mocks.inspectFunding.mockReset(); vi.clearAllMocks(); });
function fundedContext() {
  return { policy: { protocol: "keryx-registration-sponsor-v2", eligibility: "verified-publisher", funding: "wallet-balance",
    network: "eip155:5042", deploymentOrigin: "https://keryx.example", registryAddress: `0x${"22".repeat(20)}`,
    registryCodeHash: id, sponsorAddress: wallet, maxTransactionWei: "40000000000000000", maxGas: 1_000_000,
    maxFeePerGasWei: "40000000000" }, chain: { assertRegistry: vi.fn(async () => {}) } };
}
it("advertises wallet-funded discovery for any authenticated publisher with proof still required", async () => {
  mocks.session = { address: wallet }; mocks.ctx = fundedContext(); mocks.inspectFunding.mockResolvedValue({ available: true, reservedGasCovered: false });
  const result = await GET(new Request("https://keryx.example/api/sources/sponsor"));
  expect(await result.json()).toMatchObject({ available: true, eligibility: "verified-publisher", funding: "wallet-balance",
    maxGasWei: "40000000000000000", requiresPublishingProof: true });
  expect(result.headers.get("cache-control")).toBe("no-store"); expect(mocks.submit).not.toHaveBeenCalled();
});
it("reports exhausted spendable funds without exposing pool balances or granting admission", async () => {
  mocks.session = { address: wallet }; mocks.ctx = fundedContext(); mocks.inspectFunding.mockResolvedValue({ available: false, reservedGasCovered: true, spendableWei: "private" });
  const result = await (await GET(new Request("https://keryx.example/api/sources/sponsor"))).json();
  expect(result).toMatchObject({ available: false, reason: "insufficient_funds", reservedGasAvailable: true, requiresPublishingProof: true,
    network: "eip155:5042", sponsorAddress: wallet, maxGasWei: "40000000000000000" });
  expect(result.policyDigest).toMatch(/^0x[a-f0-9]{64}$/); expect(result).not.toHaveProperty("spendableWei");
  mocks.inspectFunding.mockResolvedValue({ available: false, reservedGasCovered: false });
  expect(await (await GET(new Request("https://keryx.example/api/sources/sponsor"))).json()).toMatchObject({ available: false, reservedGasAvailable: false });
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("distinguishes unavailable RPC observations from private configuration failures", async () => {
  mocks.session = { address: wallet }; mocks.ctx = fundedContext();
  mocks.inspectFunding.mockRejectedValue(new RegistrationSponsorError("private transport detail", 503, "registration_sponsor_rpc_unavailable"));
  expect(await (await GET(new Request("https://keryx.example/api/sources/sponsor"))).json()).toEqual({ available: false, reservedGasAvailable: false, reason: "rpc_unavailable" });
  mocks.runtimeError = new Error("private configuration detail");
  expect(await (await GET(new Request("https://keryx.example/api/sources/sponsor"))).json()).toEqual({ available: false, reservedGasAvailable: false, reason: "configuration_unavailable" });
});
it("keeps expired resolution an explicit same-origin owner action without replacement terms", async () => {
  expect((await POST(request({ operation: "resolveExpired", id }))).status).toBe(401);
  mocks.session = { address: wallet }; mocks.ctx = {};
  expect((await POST(request({ operation: "resolveExpired", id }, "https://foreign.example"))).status).toBe(403);
  expect((await POST(request({ operation: "resolveExpired", id, maxFee: 99 }))).status).toBe(400);
  mocks.resolveExpired.mockResolvedValue({ id, state: "submitted", expiredResolution: true });
  expect((await POST(request({ operation: "resolveExpired", id }))).status).toBe(202);
  expect(mocks.resolveExpired).toHaveBeenCalledExactlyOnceWith(mocks.ctx, wallet, id);
});

it("requires same-origin creator authentication for explicit original resume and never accepts a replacement payload", async () => {
  expect((await POST(request({ operation: "resume", id }))).status).toBe(401);
  mocks.session = { address: wallet }; mocks.ctx = {};
  expect((await POST(request({ operation: "resume", id }, "https://foreign.example"))).status).toBe(403);
  expect((await POST(request({ operation: "resume", id, signature }))).status).toBe(400);
  expect(mocks.resume).not.toHaveBeenCalled();
  mocks.resume.mockResolvedValue({ id, state: "submitted", transactionNonce: 7 });
  const response = await POST(request({ operation: "resume", id }));
  expect(response.status).toBe(202);
  expect(mocks.resume).toHaveBeenCalledExactlyOnceWith(mocks.ctx, wallet, id);
  expect(await response.json()).toEqual({ original: { id, state: "submitted", transactionNonce: 7 } });
});
it("keeps absent policy disabled without admitting an action", async () => {
  expect(await (await GET(new Request("https://keryx.example/api/sources/sponsor"))).json()).toEqual({ available: false, reservedGasAvailable: false, reason: "authentication_required" });
  mocks.session = { address: wallet };
  expect((await POST(request({ operation: "prepare", claimId: "ab".repeat(32), fetchPrice: 0.016 }))).status).toBe(503);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it.each(["https://foreign.example", "null", ""])("refuses caller Origin %s before any sponsor action", async origin => {
  mocks.session = { address: wallet }; mocks.ctx = {};
  expect((await POST(request({ operation: "submit", id, signature }, origin))).status).toBe(403);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("accepts the configured browser Origin through an internal Next listener but still requires SIWE", async () => {
  mocks.ctx = {};
  expect((await POST(request({ operation: "submit", id, signature }, "https://keryx.example", "http://127.0.0.1:3940/api/sources/sponsor"))).status).toBe(401);
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
