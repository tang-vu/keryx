import { createHash } from "node:crypto";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { BROWSER_AUTHORIZATION_PROTOCOL } from "../payments/browser-authorization-protocol";
import type { RequestSignatureFn } from "../payments/browser-cosign-gateway";
import { verifyBrowserSignature } from "../payments/verify-browser-signature";
import type { PilotServerContext } from "./server-context";

/** In-process delivery only; durable journal recovery never creates a new submitter. */
export function createPilotSignatures() {
  const slots = new Map<string, { owner: string; signer: string; epoch: string; resolve(header: string): void; reject(): void }>();
  function awaitHeader(context: PilotServerContext, owner: string, signer: string, epoch: string, abort: AbortSignal,
    send: (event: string, data: unknown) => void): RequestSignatureFn {
    return (reqId, requirements, kind, sourceId, paymentContext, admittedNonce) => new Promise((resolve, reject) => {
      if (abort.aborted || slots.has(reqId)) { reject(new Error("Pilot signature unavailable")); return; }
      const done = (header?: string) => {
        clearTimeout(timer); abort.removeEventListener("abort", cancel); slots.delete(reqId);
        if (header) resolve(header); else reject(new Error("Pilot signature unavailable"));
      };
      const cancel = () => done();
      const timer = setTimeout(cancel, 90_000);
      slots.set(reqId, { owner, signer, epoch, resolve: header => done(header), reject: cancel });
      abort.addEventListener("abort", cancel, { once: true });
      send("sign-request", { reqId, requirements, kind, sourceId, paymentContext, admittedNonce,
        capturedGrantSigner: signer, browserAuthorizationProtocol: BROWSER_AUTHORIZATION_PROTOCOL,
        enrollmentDigest: context.enrollmentDigest });
    });
  }
  async function challenge(context: PilotServerContext, owner: string, reqId: string) {
    const slot = slots.get(reqId), grant = await context.getGrant(owner);
    const journal = await context.db.getBrowserJournal(owner, reqId);
    if (!slot || slot.owner !== owner || !grant || grant.grantEpoch !== slot.epoch ||
        grant.sessAddr.toLowerCase() !== slot.signer || !journal || journal.phase !== "exposed" ||
        journal.grantEpoch !== slot.epoch || journal.signer.toLowerCase() !== slot.signer) throw new Error("Pilot challenge unavailable");
    return { enrollmentDigest: context.enrollmentDigest, ownerAddr: owner, sessAddr: slot.signer,
      grantEpoch: slot.epoch, reqId, sourceId: journal.payment.sourceId, kind: journal.payment.kind,
      requirements: journal.requirements, expectedNonce: journal.nonce,
      paymentContext: journal.payment.kind === "fetch" ? { item: journal.payment.itemId ? {
        itemId: journal.payment.itemId, itemTitle: journal.payment.itemTitle, itemUrl: journal.payment.itemUrl,
        contentVersion: journal.payment.contentVersion, itemPublishedAt: journal.payment.itemPublishedAt,
        contentReceipt: journal.payment.contentReceipt } : undefined } : undefined,
      browserAuthorizationProtocol: BROWSER_AUTHORIZATION_PROTOCOL };
  }
  async function acknowledge(context: PilotServerContext, owner: string, reqId: string, header: string) {
    const journal = await context.db.getBrowserJournal(owner, reqId);
    if (!journal || !["exposed", "signed", "submission_attempted", "settled", "failed"].includes(journal.phase))
      throw new Error("Pilot authorization unavailable");
    const auth = await verifyBrowserSignature(header, { requirements: journal.requirements,
      expectedSigner: journal.signer, expectedNonce: journal.nonce }, Math.floor(Date.parse(journal.admittedAt) / 1000), 300, ARC_MAINNET_PROFILE);
    if (!(await context.db.signBrowserJournal(owner, reqId, { validAfter: auth.validAfter, validBefore: auth.validBefore,
      headerHash: createHash("sha256").update(header).digest("hex") }))) throw new Error("Pilot acknowledgement refused");
    const slot = slots.get(reqId), grant = await context.getGrant(owner);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const delivered = !!(slot && slot.owner === owner && grant && grant.grantEpoch === slot.epoch &&
      journal.grantEpoch === slot.epoch && grant.sessAddr.toLowerCase() === slot.signer &&
      journal.signer.toLowerCase() === slot.signer && BigInt(auth.validAfter) <= now && now < BigInt(auth.validBefore));
    if (delivered) slot!.resolve(header);
    return { ok: true, delivered };
  }
  function close() { for (const slot of slots.values()) slot.reject(); }
  function revoke(owner: string, epoch: string) {
    for (const slot of slots.values()) if (slot.owner === owner && slot.epoch === epoch) slot.reject();
  }
  return Object.freeze({ awaitHeader, challenge, acknowledge, close, revoke });
}
