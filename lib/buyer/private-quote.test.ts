import { afterEach, expect, it, vi } from "vitest";
import { createPrivateQuote } from "../a2a/private-quote";
import { acceptPrivateQuote } from "./private-quote";
import { createPrivateAuthorization, matchesPrivateRequestCommitment } from "./private-request-commitment";
import { BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC } from "./protocol";

const payer = `0x${"1".repeat(40)}`, payee = `0x${"2".repeat(40)}`;
const merchants = { privatePayee: payee, publicResearchPayee: payer };
const request = { question: "What evidence supports this claim?", budget: 0.03, researchMode: "deep", packageVersion: "1.0.0", responseMode: "async" };
const provider = { modelId: "deepseek-flash", provider: "deepseek" as const, baseUrl: "https://synthetic.example/v1", apiKey: "synthetic-not-a-credential" };
const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: payee,
  maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const limits = { maxTotalMicros: "50000", maxServiceFeeMicros: "20000" };
function quote() { return createPrivateQuote(request, { provider, requirement, merchants }); }
afterEach(() => vi.unstubAllGlobals());

it("constructs a credential-free quote with exact fees and a provider-bound authorization without network access", async () => {
  const http = vi.fn(); vi.stubGlobal("fetch", http);
  const built = quote();
  expect(built.pricing).toEqual({ creatorBudgetMicros: "30000", serviceFeeMicros: "20000", totalMicros: "50000",
    unusedBudget: "retained-not-refunded", quality: "best-effort" });
  expect(JSON.stringify(built)).not.toContain(provider.apiKey);
  const accepted = acceptPrivateQuote(built, built.request, merchants, limits);
  const intent = await createPrivateAuthorization(accepted.request, accepted.requirement, payer, merchants, 1788912000000);
  expect(await matchesPrivateRequestCommitment(intent.request, accepted.requirement, intent.authorization, intent.salt)).toBe(true);
  expect(http).not.toHaveBeenCalled();
});

it("rejects changed research, provider disclosure, resource, merchant, network and misleading fee or refund terms", () => {
  const built = quote();
  if (!("reasoning" in built.request)) throw new Error("Expected bound request");
  const variants = [
    { request: { ...built.request, question: "Changed question" } },
    { request: { ...built.request, reasoning: { ...provider, endpoint: "https://other.example/chat/completions" } } },
    { request: { ...built.request, reasoning: { ...built.request.reasoning, endpoint: "https://other.example/chat/completions" } } },
    { resource: "https://keryx.cc/api/agent/ask" },
    { requirement: { ...requirement, payTo: payer } },
    { requirement: { ...requirement, network: "eip155:1" } },
    ...[{ totalMicros: "40000" }, { serviceFeeMicros: "0" }, { creatorBudgetMicros: "50000" },
      { unusedBudget: "refunded" }, { quality: "guaranteed" }].map(patch => ({ pricing: { ...built.pricing, ...patch } })),
  ];
  for (const patch of variants) expect(() => acceptPrivateQuote({ ...built, ...patch }, built.request, merchants, limits)).toThrow();
  const { reasoning: _ignored, ...legacy } = built.request as typeof built.request & { reasoning: unknown };
  expect(() => acceptPrivateQuote({ ...built, request: legacy }, legacy, merchants, limits)).toThrow();
});

it("enforces independent total and fee caps and never accepts nonpositive service fees", () => {
  const built = quote();
  for (const cap of [{ maxTotalMicros: "49999" }, { maxServiceFeeMicros: "19999" }, { maxTotalMicros: "1000001" }])
    expect(() => acceptPrivateQuote(built, built.request, merchants, { ...limits, ...cap })).toThrow();
  for (const amount of ["30000", "29999", "1000001"])
    expect(() => createPrivateQuote(request, { provider, requirement: { ...requirement, amount }, merchants })).toThrow();
});
