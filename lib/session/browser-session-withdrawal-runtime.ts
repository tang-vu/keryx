import { z } from "zod";
import type { Hex } from "viem";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { verifySessionWithdrawalPreparation } from "../gateway/session-withdrawal-protocol";
import { verifySessionWithdrawalCompletion } from "../gateway/session-withdrawal-completion";
import type { BrowserSessionCustodyContext } from "./browser-session-custody";
import { readGatewayCredit } from "../gateway/read-credit";
import { readBrowserSessionWithdrawalChain, observeBrowserSessionWithdrawalCompletion } from "./browser-session-withdrawal-chain";
import { readBrowserWithdrawalLiabilities } from "./browser-session-withdrawal-liabilities";
import { readBrowserSessionExposure, readBrowserSessionWithdrawal, reserveBrowserSessionWithdrawal,
  retainBrowserSessionWithdrawalOutcome, cancelUnexposedBrowserWithdrawal, abortBrowserSessionWithdrawalPublication,
  confirmBrowserSessionWithdrawalAbort } from "./browser-session-withdrawal-storage";
import { createSessionWithdrawalAbort, verifySessionWithdrawalAbort } from "../gateway/session-withdrawal-abort";

const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const micros = z.string().regex(/^(0|[1-9]\d{0,15})$/).refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
export const browserSessionWithdrawalReviewSchema = z.object({ amountMicroUsdc: micros.refine(v => BigInt(v)>BigInt(0)), maxFeeMicroUsdc: micros }).strict();
export type BrowserSessionWithdrawalReview = z.infer<typeof browserSessionWithdrawalReviewSchema>;
const statusSchema = z.object({ preparation: z.unknown(), signingPhase: z.enum(["prepared","exposed","cancelled_unexposed","completed","aborted_before_publication"]), publicationAbort: z.unknown().optional(),
  cancellation: z.unknown().nullable(), progress: z.object({ status: z.string(), retryAuthorized: z.literal(false), chainFinalityVerified: z.boolean() }).strict(),
  attestation: z.unknown().nullable(), mint: z.unknown().nullable(), completion: z.unknown().nullable() }).strict();
const cancellationSchema = z.object({ format: z.literal("keryx-session-withdrawal-cancellation-v1"), network: z.literal(profile.networkId),
  requestId: hash, ownerAddr: z.string(), sessAddr: z.string(), reason: z.literal("cancelled-unexposed") }).strict();
export interface SessionWithdrawalRuntimeKey {
  readonly context: BrowserSessionCustodyContext;
  readonly address: Hex|null;
  signWithdrawalPreparation(value: unknown): Promise<Hex>;
  signWithdrawalAbort?(value: unknown): Promise<Hex>;
}
export type SessionWithdrawalRuntimeStorage = {
  readExposure: typeof readBrowserSessionExposure;
  readWithdrawal: typeof readBrowserSessionWithdrawal;
  reserveWithdrawal: typeof reserveBrowserSessionWithdrawal;
  retainOutcome: typeof retainBrowserSessionWithdrawalOutcome;
  cancelUnexposed: typeof cancelUnexposedBrowserWithdrawal;
  abortPublication?: typeof abortBrowserSessionWithdrawalPublication;
  confirmPublicationAbort?: typeof confirmBrowserSessionWithdrawalAbort;
};

/** Separate recovery permission: expired payment consent never blocks owner-only cashout.
 * Page supplies a request ID and its locally reviewed amount/fee ceiling, never a signer payload. */
export function createBrowserSessionWithdrawalRuntime(key: SessionWithdrawalRuntimeKey, dependencies: {
  json(path: string, method?: string, body?: unknown): Promise<unknown>;
  credit?: typeof readGatewayCredit; chain?: typeof readBrowserSessionWithdrawalChain;
  completion?: typeof observeBrowserSessionWithdrawalCompletion;
  storage?: SessionWithdrawalRuntimeStorage;
}) {
  if(key.context.profile!==profile)throw new Error("Mainnet withdrawal custody profile refused");
  const storage=dependencies.storage??{readExposure:readBrowserSessionExposure,readWithdrawal:readBrowserSessionWithdrawal,
    reserveWithdrawal:reserveBrowserSessionWithdrawal,retainOutcome:retainBrowserSessionWithdrawalOutcome,cancelUnexposed:cancelUnexposedBrowserWithdrawal,
    abortPublication:abortBrowserSessionWithdrawalPublication,confirmPublicationAbort:confirmBrowserSessionWithdrawalAbort};
  let generation = 0;
  const namespace = key.context.storageNamespace;
  const refuse = (): never => { throw new Error("Original session withdrawal refused; retain its recovery record"); };
  async function status(requestId: string) {
    hash.parse(requestId);
    const value = statusSchema.parse(await dependencies.json(`/api/session/withdraw/${requestId}`));
    const p = await verifySessionWithdrawalPreparation(value.preparation);
    if (!key.address || p.requestId !== requestId || p.ownerAddr !== key.context.owner ||
      p.sessAddr !== key.address.toLowerCase() || p.authorization.consent.origin !== key.context.origin) refuse();
    return { value, preparation: p };
  }
  return Object.freeze({
    lock() { generation++; },
    async abortWithdrawal(requestId: string) {
      hash.parse(requestId);
      const expected = generation, retained = await storage.readWithdrawal(namespace, requestId);
      if (!retained || !storage.abortPublication || !storage.confirmPublicationAbort || !key.signWithdrawalAbort) return refuse();
      const p = await verifySessionWithdrawalPreparation(retained.preparation);
      const live = () => { if (generation !== expected || key.address?.toLowerCase() !== p.sessAddr || p.ownerAddr !== key.context.owner ||
        p.authorization.consent.origin !== key.context.origin || p.requestId !== requestId) refuse(); };
      live();
      // Fence publication before the first HTTP request. An interrupted crypto call
      // or stale tab must fail its later signature retention, including legacy tabs.
      await storage.abortPublication(namespace, p); live();
      const original = await status(requestId); live();
      if (canonicalJson(original.preparation) !== canonicalJson(p) || original.value.completion ||
        !["prepared", "exposed", "cancelled_unexposed", "aborted_before_publication"].includes(original.value.signingPhase)) refuse();
      if (original.value.signingPhase === "cancelled_unexposed") {
        const cancellation = cancellationSchema.parse(original.value.cancellation);
        if (cancellation.requestId !== requestId || cancellation.ownerAddr !== p.ownerAddr || cancellation.sessAddr !== p.sessAddr) refuse();
      } else if (original.value.cancellation) refuse();
      const proof = original.value.publicationAbort
        ? await verifySessionWithdrawalAbort(original.value.publicationAbort, p)
        : await createSessionWithdrawalAbort(p, await key.signWithdrawalAbort(p));
      live();
      const response = statusSchema.parse(await dependencies.json("/api/session/withdraw/abort", "POST", { requestId, signature: proof.signature }));
      live();
      if (response.signingPhase !== "aborted_before_publication" || response.completion || response.cancellation ||
        canonicalJson(await verifySessionWithdrawalPreparation(response.preparation)) !== canonicalJson(p) ||
        canonicalJson(await verifySessionWithdrawalAbort(response.publicationAbort, p)) !== canonicalJson(proof)) refuse();
      await storage.confirmPublicationAbort(namespace, p, proof); live();
      return { requestId, abortedBeforePublication: true };
    },
    async signWithdrawal(requestId: string, reviewValue: BrowserSessionWithdrawalReview) {
      const expected = generation, review = browserSessionWithdrawalReviewSchema.parse(reviewValue);
      let original = await status(requestId);
      const p = original.preparation;
      const live = () => { if (generation !== expected || key.address?.toLowerCase() !== p.sessAddr) refuse(); };
      const checkOriginal = (current: Awaited<ReturnType<typeof status>>) => {
        if (canonicalJson(current.preparation) !== canonicalJson(p) || !["prepared","exposed"].includes(current.value.signingPhase) ||
          current.value.progress.status !== "prepared" || current.value.completion || current.value.cancellation) refuse();
      };
      live(); checkOriginal(original);
      if (p.burnIntent.spec.value !== review.amountMicroUsdc || BigInt(p.burnIntent.maxFee)>BigInt(review.maxFeeMicroUsdc)) refuse();
      const retained = await storage.readWithdrawal(namespace, requestId); live();
      if (retained && (canonicalJson(retained.preparation) !== canonicalJson(p) || retained.cancelled || retained.completion)) refuse();
      const snapshot = await storage.readExposure(namespace); live();
      if (snapshot.withdrawal && snapshot.withdrawal !== requestId) refuse();
      const held = await readBrowserWithdrawalLiabilities(snapshot.authorizations, p.ownerAddr, p.sessAddr, p.grantEpoch, dependencies.json); live();
      const checkFresh = async () => {
        await (dependencies.chain ?? readBrowserSessionWithdrawalChain)(p); live();
        const available = await (dependencies.credit ?? readGatewayCredit)(p.sessAddr); live();
        const liability = held > BigInt(p.balance.heldPaymentMicroUsdc) ? held : BigInt(p.balance.heldPaymentMicroUsdc);
        if (BigInt(p.burnIntent.spec.value)+BigInt(p.burnIntent.maxFee)+liability+BigInt(p.balance.heldWithdrawalMicroUsdc)>available) refuse();
      };
      await checkFresh();
      if(retained?.signature)return {signature:retained.signature as Hex,requestId};
      if (!retained) await storage.reserveWithdrawal(namespace, p, snapshot.version);
      live();
      // Commit local exposure before the HTTP call: losing its acknowledgement cannot imply cancellation safety.
      await storage.retainOutcome(namespace, p, { exposed: true }); live();
      const authorized = statusSchema.parse(await dependencies.json("/api/session/withdraw/authorize", "POST", { requestId }));
      if (authorized.signingPhase !== "exposed" || canonicalJson(await verifySessionWithdrawalPreparation(authorized.preparation)) !== canonicalJson(p)) refuse();
      original = await status(requestId); live(); checkOriginal(original);
      await checkFresh();
      const signature = await key.signWithdrawalPreparation(p); live();
      await storage.retainOutcome(namespace, p, { signature }); live();
      return { requestId, signature };
    },
    async cancelUnexposedWithdrawal(requestId: string) {
      const expected = generation, original = await status(requestId), p = original.preparation;
      const local = await storage.readWithdrawal(namespace, requestId);
      if (local?.exposed || local?.signature || local?.completion || generation !== expected) refuse();
      const response = statusSchema.parse(await dependencies.json("/api/session/withdraw/cancel", "POST", { requestId }));
      const ack = cancellationSchema.parse(response.cancellation);
      if (generation !== expected || response.signingPhase !== "cancelled_unexposed" || ack.requestId !== requestId ||
        ack.ownerAddr !== key.context.owner || ack.sessAddr !== p.sessAddr || canonicalJson(await verifySessionWithdrawalPreparation(response.preparation)) !== canonicalJson(p)) refuse();
      await storage.cancelUnexposed(namespace, p); return { requestId, cancelledUnexposed: true };
    },
    async reconcileWithdrawal(requestId: string) {
      const expected = generation, original = await status(requestId), p = original.preparation;
      const retained = await storage.readWithdrawal(namespace, requestId);
      if (!retained) return refuse();
      if (canonicalJson(retained.preparation) !== canonicalJson(p) || retained.cancelled) refuse();
      if (!original.value.completion || original.value.signingPhase !== "completed" || !original.value.progress.chainFinalityVerified) {
        return { requestId, completed: false, status: original.value.progress.status };
      }
      const completion = await verifySessionWithdrawalCompletion(original.value.completion, p);
      await (dependencies.completion ?? observeBrowserSessionWithdrawalCompletion)(completion);
      if (generation !== expected || key.address?.toLowerCase() !== p.sessAddr) refuse();
      if (!retained.completion) await storage.retainOutcome(namespace, p, { completion });
      return { requestId, completed: true, status: "mint-finalized-observed" };
    },
  });
}
