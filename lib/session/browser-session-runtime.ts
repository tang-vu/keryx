import { z } from "zod";
import { recoverMessageAddress, type Hex } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage, parseSessionGrantConsent } from "../payments/session-grant-consent";
import { validateBrowserFetchPrice } from "../payments/browser-fetch-price-policy";
import type { BrowserPaymentContext } from "../payments/browser-cosign-gateway";
import type { SourcePaymentAuthority } from "../payments/client-payto-allowlist";
import type { BrowserSessionCustodyContext } from "./browser-session-custody";
import type { TypedDataPayload } from "./session-signer-protocol";

/** Shared browser/headless admission. Implementations retain custody and reserve exposure;
 * this interface offers only the specific payment primitive consumed by this policy. */
export interface SessionRuntimeKey {
  readonly context: BrowserSessionCustodyContext;
  readonly address: Hex | null;
  signPayment(payload: TypedDataPayload): Promise<Hex>;
  lock(): void;
}
export type BrowserQuestionBudget = { id: string; budgetMicroUsdc: string };

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(a => a.toLowerCase());
const positive = z.string().regex(/^[1-9]\d{0,15}$/).refine(n => /^[1-9]\d{0,15}$/.test(n) && BigInt(n) <= BigInt(Number.MAX_SAFE_INTEGER));
const nonnegative = z.string().regex(/^(0|[1-9]\d{0,15})$/).refine(n => BigInt(n) <= BigInt(Number.MAX_SAFE_INTEGER));
const grantSchema = z.object({ active: z.literal(true), sessionId: addr, ownerAddr: addr, sessAddr: addr,
  grantEpoch: z.string().uuid(), network: z.literal(profile.networkId), origin: z.string(), capMicroUsdc: positive, spentMicroUsdc: nonnegative,
  consent: z.unknown(), ownerSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/), sessionSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) });
const challengeSchema = z.object({ sessionId: addr, reqId: z.string().uuid(), grantEpoch: z.string().uuid(), sessAddr: addr,
  sourceId: z.string().min(1).max(128), kind: z.enum(["fetch", "citation"]),
  expectedNonce: z.string().regex(/^0x[0-9a-f]{64}$/), browserAuthorizationProtocol: z.literal("durable-v1"),
  requirements: z.object({ scheme: z.literal("exact"), network: z.literal(profile.networkId), amount: positive, payTo: addr,
    asset: addr.refine(a => a === profile.usdcAddress.toLowerCase()), maxTimeoutSeconds: z.number().int().min(604900).max(691200),
    extra: z.object({ name: z.literal("GatewayWalletBatched"), version: z.literal("1"),
      verifyingContract: addr.refine(a => a === profile.gatewayWallet.toLowerCase()) }).strict() }).strict(),
  paymentContext: z.object({ item: z.record(z.string(), z.unknown()).optional(), offer: z.record(z.string(), z.unknown()).optional() }).strict().optional(),
});
const sourceIndexSchema = z.array(z.object({ id: z.string(), onchainId: z.string().regex(/^0x[0-9a-f]{64}$/).optional() })).max(1000);
const itemSchema = z.object({ itemId: z.string().min(1).max(1024), contentVersion: z.string().min(1).max(256) }).passthrough();
const previewSchema = z.object({ sourceId: z.string(), item: itemSchema, payTo: addr,
  listPriceMicroUsdc: z.string().regex(/^(0|[1-9]\d{0,15})$/) }).strict();
export type BrowserSessionOperation =
  | { type: "initializeOwner"; owner: string }
  | { type: "deriveFromSignature"; signature: Hex }
  | { type: "restoreRetained" }
  | { type: "authorizePayment"; reqId: string; question: BrowserQuestionBudget }
  | { type: "bindGrant" }
  | { type: "signGrantConsentProof"; consent: unknown; ownerSignature: Hex }
  | { type: "lock" };

/** The page can notify a reqId; only current cookie authority, signed owner consent and a fresh
 * independently attested registry can admit its exact payment tuple. No arbitrary typed signer.
 */
export function createBrowserSessionRuntime(key: SessionRuntimeKey, dependencies: {
  json(path: string, method?: string, body?: unknown): Promise<unknown>;
  readSource(registryId: string): Promise<SourcePaymentAuthority>;
  reserve(namespace: string, epoch: string, nonce: string, amount: bigint, cap: bigint, question: BrowserQuestionBudget): Promise<void>;
}) {
  if (key.context.profile !== profile) throw new Error("Browser session profile refused");
  const refuse = (): never => { throw new Error("Browser payment authorization refused"); };
  let generation = 0;
  async function bindGrant() {
    const address = key.address;
    if (!address) refuse();
    const response = grantSchema.parse(await dependencies.json("/api/session/grant"));
    const consent = parseSessionGrantConsent(response.consent, profile);
    if (response.sessionId !== key.context.owner || response.ownerAddr !== key.context.owner ||
      response.sessAddr !== address!.toLowerCase() || response.origin !== key.context.origin ||
      consent.ownerAddr !== key.context.owner || consent.sessAddr !== response.sessAddr ||
      consent.origin !== key.context.origin || consent.grantEpoch !== response.grantEpoch ||
      consent.capMicroUsdc !== response.capMicroUsdc || BigInt(consent.expirySeconds) <= BigInt(Math.floor(Date.now()/1000)) ||
      BigInt(consent.expirySeconds) > BigInt(Math.floor(Date.now()/1000)+86400) ||
      (await recoverMessageAddress({ message: createSessionGrantConsentMessage(consent, profile),
        signature: response.ownerSignature as Hex })).toLowerCase() !== key.context.owner ||
      (await recoverMessageAddress({ message: createSessionGrantSignerProofMessage(consent, profile),
        signature: response.sessionSignature as Hex })).toLowerCase() !== response.sessAddr) refuse();
    return { response, consent };
  }
  return Object.freeze({
    bindGrant,
    lock() { generation += 1; key.lock(); },
    async authorizePayment(reqId: string, question: BrowserQuestionBudget) {
      z.string().uuid().parse(reqId);
      const scope = z.object({ id: z.string().uuid(), budgetMicroUsdc: positive }).strict().parse(question);
      const expectedGeneration = generation, bound = await bindGrant();
      const challenge = challengeSchema.parse(await dependencies.json("/api/ask/challenge", "POST", { reqId }));
      if (challenge.reqId !== reqId || challenge.sessionId !== key.context.owner || challenge.sessAddr !== bound.response.sessAddr ||
        challenge.grantEpoch !== bound.consent.grantEpoch) refuse();
      const indexBody = await dependencies.json("/api/sources");
      const sources = sourceIndexSchema.parse(Array.isArray(indexBody) ? indexBody : (indexBody as { sources?: unknown })?.sources);
      const entry = sources.find(source => source.id === challenge.sourceId);
      if (!entry?.onchainId) refuse();
      const authority = await dependencies.readSource(entry!.onchainId!);
      const requirements = challenge.requirements, payTo = requirements.payTo;
      if (!authority.active || !authority.onchain || (challenge.kind === "fetch"
        ? payTo !== authority.fetchPayTo.toLowerCase() : !authority.wallets.has(payTo))) refuse();
      if (challenge.kind === "fetch") {
        if (challenge.paymentContext?.item) {
          const item = itemSchema.parse(challenge.paymentContext.item);
          const path = `/api/source/${encodeURIComponent(challenge.sourceId)}/item/${encodeURIComponent(item.itemId)}/preview?version=${encodeURIComponent(item.contentVersion)}`;
          const preview = previewSchema.parse(await dependencies.json(path));
          const listPrice = Math.round(authority.listPriceUsdc * 1e6);
          if (!Number.isSafeInteger(listPrice) || listPrice < 0 || preview.sourceId !== challenge.sourceId ||
            preview.payTo !== authority.fetchPayTo.toLowerCase() || preview.listPriceMicroUsdc !== String(listPrice) ||
            canonicalJson(preview.item) !== canonicalJson(item)) refuse();
        }
        const price = await validateBrowserFetchPrice({ sourceId: challenge.sourceId, amountUsdc6: requirements.amount,
          authority, context: challenge.paymentContext as BrowserPaymentContext });
        if (!price.allowed) refuse();
      } else if (challenge.paymentContext) refuse();
      await dependencies.reserve(key.context.storageNamespace, bound.consent.grantEpoch, challenge.expectedNonce,
        BigInt(requirements.amount), BigInt(bound.consent.capMicroUsdc), scope);
      if (canonicalJson(await bindGrant()) !== canonicalJson(bound) || expectedGeneration !== generation) refuse();
      const now = Math.floor(Date.now()/1000), authorization = { from: bound.response.sessAddr as Hex,
        to: requirements.payTo as Hex, value: requirements.amount, validAfter: String(now-600),
        validBefore: String(now+requirements.maxTimeoutSeconds), nonce: challenge.expectedNonce as Hex };
      const signature = await key.signPayment({ domain: { name: "GatewayWalletBatched", version: "1", chainId: profile.chainId,
        verifyingContract: profile.gatewayWallet }, types: { TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" } ] },
        primaryType: "TransferWithAuthorization", message: authorization });
      if (expectedGeneration !== generation || canonicalJson(await bindGrant()) !== canonicalJson(bound)) refuse();
      return { paymentHeader: btoa(JSON.stringify({ authorization, signature })) };
    },
  });
}
