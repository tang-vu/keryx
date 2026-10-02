/// <reference lib="webworker" />
import type { Hex } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { compiledMainnetEnrollment } from "../mainnet-pilot/compiled-mainnet-enrollment";
import { createPilotGrantMessage, type VerifiedPublicMainnetEnrollment } from "../mainnet-pilot/public-enrollment";
import { pilotJson } from "../mainnet-pilot/browser-http";
import { pilotChallengeSchema, pilotGrantSchema, pilotItemPreviewSchema, type PilotBrowserRequest } from "../mainnet-pilot/browser-wire";
import { createMainnetBrowserSourceAuthority } from "../mainnet-pilot/browser-source-authority";
import { reserveBrowserPilotAuthorization } from "../mainnet-pilot/browser-authorization-capacity";
import { createIsolatedSessionSigner } from "./isolated-session-signer";
import { indexedDbWrappingKeyStore } from "./isolated-session-vault";
declare const self: DedicatedWorkerGlobalScope;
let verified: VerifiedPublicMainnetEnrollment | null = null;
let signer: ReturnType<typeof createIsolatedSessionSigner> | null = null;
let address: string | null = null;
let payees: ReadonlySet<string> = new Set();
let activeOperations = 0;
let revoking = false;
let operationGeneration = 0;
let grant: ReturnType<typeof pilotGrantSchema.parse> | null = null;
const fail = (): never => { throw new Error("mainnet browser authorization refused"); };
function ready(allowExpired = false) {
  if (!verified || !signer || verified.enrollment.origin !== self.location.origin ||
    (!allowExpired && Math.floor(Date.now() / 1000) >= verified.enrollment.expiresAtSeconds)) fail();
  return { verified: verified!, signer: signer! };
}
async function bindGrant() {
  grant = null;
  const current = ready(), response = pilotGrantSchema.parse(await pilotJson("/api/mainnet-pilot/grant"));
  createPilotGrantMessage(current.verified, { owner: response.owner, signer: response.signer, grantEpoch: response.grantEpoch,
    capMicroUsdc: response.capMicroUsdc, expirySeconds: response.expirySeconds });
  if (!address || response.enrollmentDigest !== current.verified.enrollmentDigest || response.owner !== current.signer.context.owner ||
    response.signer !== address.toLowerCase() || BigInt(response.expirySeconds) <= BigInt(Math.floor(Date.now()/1000))) fail();
  grant = response; return response;
}
async function handle(request: PilotBrowserRequest) {
  if (request.type === "initialize") {
    if (signer) fail();
    verified = await compiledMainnetEnrollment(self.location.origin);
    if (!verified.enrollment.invitedBuyers.includes(request.owner)) fail();
    signer = createIsolatedSessionSigner({ profile, origin: self.location.origin, owner: request.owner as Hex,
      epoch: verified.enrollment.epoch, candidateDigest: `0x${verified.enrollmentDigest}`,
      maxPaymentMicroUsdc: String(verified.enrollment.limits.perPaymentMicros), expiresAtSeconds: verified.enrollment.expiresAtSeconds },
      { store: indexedDbWrappingKeyStore(), currentOrigin: () => self.location.origin,
        authorisedPayees: async () => new Set(payees) });
    return { derivationMessage: signer.context.derivationMessage, storageNamespace: signer.context.storageNamespace };
  }
  const current = ready(request.type === "revoke");
  if (request.type === "derive") {
    grant = null; address = null; const blob = await current.signer.derive(request.signature); address = blob.address; return blob;
  }
  if (request.type === "restore") { grant = null; address = null; address = await current.signer.restore(request.blob); return { address }; }
  if (request.type === "bindGrant") return bindGrant();
  if (request.type === "revoke") {
    // Server epoch/cookie revocation precedes destruction; storage deletion is not a refund.
    grant = null;
    const response = await pilotJson("/api/mainnet-pilot/grant", "DELETE");
    if (canonicalJson(response) !== canonicalJson({ revoked: true, retainedAuthorizations: true })) fail();
    await current.signer.clear(); address = null; return response;
  }
  if (request.type !== "sign" || !address) fail();
  // Re-read current cookie authority before every signature; another tab's logout cancels it.
  const bound = await bindGrant();
  const challenge = pilotChallengeSchema.parse(await pilotJson("/api/mainnet-pilot/challenge", "POST", { reqId: request.reqId }));
  if (challenge.reqId !== request.reqId || challenge.enrollmentDigest !== current.verified.enrollmentDigest ||
    challenge.ownerAddr.toLowerCase() !== bound.owner || challenge.sessAddr.toLowerCase() !== bound.signer ||
    challenge.grantEpoch !== bound.grantEpoch || !current.verified.enrollment.approvedSourceIds.includes(challenge.sourceId)) fail();
  const authority = await createMainnetBrowserSourceAuthority(current.verified).read(challenge.sourceId);
  const r = challenge.requirements, amount = BigInt(r.amount), to = r.payTo.toLowerCase();
  if (amount > BigInt(current.verified.enrollment.limits.perPaymentMicros)) fail();
  if (challenge.kind === "fetch") {
    const item = challenge.paymentContext?.item;
    if (!item || to !== authority.payout || amount !== authority.fetchPriceMicroUsdc) fail();
    const preview = pilotItemPreviewSchema.parse(await pilotJson(`/api/mainnet-pilot/source/${challenge.sourceId}/item/${encodeURIComponent(item!.itemId)}/preview?version=${encodeURIComponent(item!.contentVersion)}`));
    if (preview.sourceId !== challenge.sourceId || canonicalJson(preview.item) !== canonicalJson(item) ||
      preview.payTo.toLowerCase() !== authority.payout || BigInt(preview.listPriceMicroUsdc) !== authority.fetchPriceMicroUsdc ||
      amount !== BigInt(preview.listPriceMicroUsdc)) fail();
    payees = new Set([authority.payout]);
  } else {
    if (challenge.paymentContext || !authority.payees.includes(to)) fail();
    payees = new Set(authority.payees);
  }
  // Retained across grant epochs and clear/reload: no nonce can sign twice and failed delivery
  // consumes signed capacity. A compromised page cannot reset this via worker messages.
  await reserveBrowserPilotAuthorization(current.signer.context.storageNamespace, challenge.expectedNonce, amount,
    BigInt(bound.capMicroUsdc));
  const refreshed = await bindGrant();
  if (canonicalJson(refreshed) !== canonicalJson(bound)) fail();
  const now = Math.floor(Date.now()/1000);
  const authorization = { from: address as Hex, to: r.payTo as Hex, value: r.amount,
    validAfter: String(now - 600), validBefore: String(now + r.maxTimeoutSeconds), nonce: challenge.expectedNonce as Hex };
  const signature = await current.signer.signPayment({ domain: { name: "GatewayWalletBatched", version: "1", chainId: profile.chainId,
    verifyingContract: profile.gatewayWallet }, types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" } ] },
    primaryType: "TransferWithAuthorization", message: authorization });
  // Another tab may revoke while cryptography awaits. Never publish after that server boundary.
  if (canonicalJson(await bindGrant()) !== canonicalJson(bound)) fail();
  if (BigInt(bound.expirySeconds) <= BigInt(Math.floor(Date.now()/1000))) fail();
  return { paymentHeader: btoa(JSON.stringify({ authorization, signature })) };
}
self.onmessage = (event: MessageEvent<PilotBrowserRequest & { id: number }>) => {
  const request = event.data;
  if (!Number.isSafeInteger(request?.id) || request.id < 0) return;
  if (revoking || (activeOperations > 0 && request.type !== "revoke")) { self.postMessage({ id: request.id, ok: false, error: "mainnet browser worker busy" }); return; }
  if (request.type === "revoke") { revoking = true; operationGeneration += 1; }
  const capturedGeneration = operationGeneration;
  activeOperations += 1;
  void handle(request).then(result => {
    if (capturedGeneration !== operationGeneration) fail();
    self.postMessage({ id: request.id, ok: true, result });
  }).catch(
    () => self.postMessage({ id: request.id, ok: false, error: "mainnet browser operation refused" }))
    .finally(() => { payees = new Set(); activeOperations -= 1; if (request.type === "revoke") revoking = false; });
};
