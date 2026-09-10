import { afterEach, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { buyPrivateBrowserResearch, type PrivateBrowserStorage } from "./private-browser-client";
import { privateBrowserFetch } from "./private-browser-transport";
import { createPrivateQuote } from "../a2a/private-quote";
import { buyerTypedData, BUYER_ORIGIN, BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC } from "./protocol";
import { preparePrivateResearchIntent } from "../a2a/private-research-intent";
import { validatePrivateBuyerIntent } from "./private-buyer-intent";
import type { BuyerFetch } from "./transport";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`), payer = account.address.toLowerCase();
const merchants = { privatePayee: `0x${"2".repeat(40)}`, publicResearchPayee: `0x${"3".repeat(40)}` };
const limits = { maxTotalMicros: "50000", maxServiceFeeMicros: "20000" };
const provider = { modelId: "deepseek-flash", provider: "deepseek" as const, baseUrl: "https://synthetic.example/v1", apiKey: "synthetic-not-secret" };
const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: merchants.privatePayee,
  maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
function fixture() {
  const quote = createPrivateQuote({ question: "Synthetic private question", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" },
    { provider, requirement, merchants });
  const state = { owner: payer, available: true, quote: structuredClone(quote), claimed: false, outcome: "ok", saved: false };
  const steps: string[] = [], paymentRequests: unknown[] = [];
  const journal = {
    reserve: vi.fn(async () => { steps.push("reserved"); }),
    saveSignature: vi.fn(async (value: unknown) => { await validatePrivateBuyerIntent(value, payer, merchants); state.saved = true; steps.push("saved"); }),
    claim: vi.fn(async () => { expect(state.saved).toBe(true); steps.push("claimed"); if (state.claimed) return false; state.claimed = true; return true; }),
  };
  const http = vi.fn<BuyerFetch>(async (url, init) => {
    if (url.endsWith("/auth/session")) return Response.json({ session: { address: state.owner, role: "user" } });
    if (url.endsWith("/private-jobs/quote")) return Response.json({ wallet: payer, purchasingAvailable: state.available, quote: state.quote });
    expect(url).toBe(`${BUYER_ORIGIN}/api/agent/private-ask`); expect(init?.method).toBe("POST");
    expect(state.claimed).toBe(true); expect(state.saved).toBe(true);
    paymentRequests.push(JSON.parse(String(init?.body))); steps.push("posted");
    const intent = await preparePrivateResearchIntent(paymentRequests[0], requirement, merchants);
    if (state.outcome === "lost") throw new Error("Synthetic lost response");
    if (state.outcome === "rejected") return new Response(null, { status: 503 });
    return Response.json({ id: state.outcome === "wrong-id" ? "wrong" : intent.id, paymentStatus: "settled" }, { status: 202 });
  });
  const input = { request: quote.request, acceptedQuote: quote, payer, merchants, limits, localStorageAccepted: true,
    readWallet: vi.fn(async () => ({ address: payer, chainId: 5042002, gatewayBalanceMicros: "50000" })),
    sign: vi.fn(async (authorization: Parameters<typeof buyerTypedData>[0]) => { steps.push("signed"); return account.signTypedData(buyerTypedData(authorization)); }),
    onReserved: vi.fn(async () => { steps.push("notified"); }),
  };
  const deps = { http, journal: journal as unknown as PrivateBrowserStorage, now: () => 1788912000000 };
  return { input, deps, state, steps, paymentRequests, journal };
}
afterEach(() => vi.unstubAllGlobals());

it.each(["ok", "lost", "rejected", "wrong-id"])("submits once after durable signing and preserves %s response evidence", async (outcome) => {
  const f = fixture(); f.state.outcome = outcome;
  const result = await buyPrivateBrowserResearch(f.input, f.deps);
  expect(result.status).toBe(outcome === "ok" ? "response-received" : "recovery-required");
  expect(result.submissionAttempted).toBe(true);
  expect(f.steps).toEqual(["reserved", "notified", "signed", "saved", "claimed", "posted"]);
  expect(f.input.sign).toHaveBeenCalledTimes(1); expect(f.paymentRequests).toHaveLength(1);
});

it.each(["consent", "session", "unavailable", "price", "provider", "balance", "chain"])("refuses %s before storage and signing", async (change) => {
  const f = fixture();
  if (change === "consent") f.input.localStorageAccepted = false;
  if (change === "session") f.state.owner = merchants.publicResearchPayee;
  if (change === "unavailable") f.state.available = false;
  if (change === "price") { f.state.quote.requirement.amount = "40000"; f.state.quote.pricing.totalMicros = "40000"; f.state.quote.pricing.serviceFeeMicros = "10000"; }
  if (change === "provider") f.state.quote.request.reasoning.endpoint = "https://changed.example/v1/chat/completions";
  if (change === "balance") f.input.readWallet.mockResolvedValue({ address: payer, chainId: 5042002, gatewayBalanceMicros: "49999" });
  if (change === "chain") f.input.readWallet.mockResolvedValue({ address: payer, chainId: 1, gatewayBalanceMicros: "50000" });
  await expect(buyPrivateBrowserResearch(f.input, f.deps)).rejects.toThrow();
  expect(f.journal.reserve).not.toHaveBeenCalled(); expect(f.input.sign).not.toHaveBeenCalled(); expect(f.paymentRequests).toHaveLength(0);
});

it.each(["reserve", "saveSignature", "claim"] as const)("fails closed on %s storage failure", async (stage) => {
  const f = fixture(); f.journal[stage].mockRejectedValue(new Error("Synthetic storage failure"));
  await expect(buyPrivateBrowserResearch(f.input, f.deps)).rejects.toThrow();
  expect(f.paymentRequests).toHaveLength(0);
  if (stage === "reserve") expect(f.input.sign).not.toHaveBeenCalled();
});

it("preserves the signature but stops when the wallet changes after signing", async () => {
  const f = fixture();
  f.input.readWallet.mockResolvedValueOnce({ address: payer, chainId: 5042002, gatewayBalanceMicros: "50000" })
    .mockResolvedValueOnce({ address: payer, chainId: 5042002, gatewayBalanceMicros: "50000" })
    .mockResolvedValue({ address: merchants.publicResearchPayee, chainId: 5042002, gatewayBalanceMicros: "50000" });
  await expect(buyPrivateBrowserResearch(f.input, f.deps)).rejects.toThrow();
  expect(f.state.saved).toBe(true); expect(f.journal.claim).not.toHaveBeenCalled(); expect(f.paymentRequests).toHaveLength(0);
});

it.each(["session-changed", "cancelled", "invalid-signature"])("retains recovery and refuses %s after the wallet prompt", async (reason) => {
  const f = fixture(), abort = new AbortController();
  f.input.sign.mockImplementation(async authorization => {
    if (reason === "session-changed") f.state.owner = merchants.publicResearchPayee;
    if (reason === "cancelled") abort.abort();
    return reason === "invalid-signature" ? `0x${"0".repeat(130)}` as `0x${string}` : account.signTypedData(buyerTypedData(authorization));
  });
  await expect(buyPrivateBrowserResearch({ ...f.input, signal: abort.signal }, f.deps)).rejects.toThrow();
  expect(f.input.onReserved).toHaveBeenCalledTimes(1);
  expect(f.state.saved).toBe(reason !== "invalid-signature");
  expect(f.journal.claim).not.toHaveBeenCalled(); expect(f.paymentRequests).toHaveLength(0);
});

it.each(["abort", "expired", "claimed"])("keeps %s jobs recovery-only without posting", async (reason) => {
  const f = fixture(), abort = new AbortController();
  if (reason === "claimed") f.state.claimed = true;
  if (reason === "expired") f.deps.now = vi.fn().mockReturnValueOnce(1788912000000).mockReturnValue(1789912000000);
  if (reason === "abort") f.journal.claim.mockImplementation(async () => { f.state.claimed = true; abort.abort(); return true; });
  expect(await buyPrivateBrowserResearch({ ...f.input, signal: abort.signal }, f.deps)).toMatchObject({ status: "recovery-required", submissionAttempted: false });
  expect(f.paymentRequests).toHaveLength(0); expect(f.state.saved).toBe(true);
});

it("restricts credentialed transport to same-origin private routes and prohibits redirects", async () => {
  vi.stubGlobal("location", { origin: BUYER_ORIGIN });
  const http = vi.fn(async () => new Response(null, { status: 204 })); vi.stubGlobal("fetch", http);
  await privateBrowserFetch(`${BUYER_ORIGIN}/api/auth/session`);
  expect(http).toHaveBeenCalledWith(`${BUYER_ORIGIN}/api/auth/session`, expect.objectContaining({ credentials: "same-origin", redirect: "error", cache: "no-store" }));
  for (const url of [`${BUYER_ORIGIN}/api/agent/ask`, `${BUYER_ORIGIN}/api/me/private-jobs/result?id=private`, "https://foreign.example/api/auth/session"])
    await expect(privateBrowserFetch(url, { method: "POST" })).rejects.toThrow();
  vi.stubGlobal("location", { origin: "https://foreign.example" });
  await expect(privateBrowserFetch(`${BUYER_ORIGIN}/api/auth/session`)).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(1);
});
