import { recoverMessageAddress, type Hex } from "viem";
import type { KeryxDB } from "../db/keryx-db";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { mainnetGrantPolicy } from "./mainnet-session-grants";
import { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage, parseSessionGrantConsent } from "./session-grant-consent";

/** Recovery ownership only, including after payment expiry/revoke. This never
 * renews payment permission or treats a public proof as custody material. */
export async function readRetainedMainnetSessionAuthority(db: Pick<KeryxDB, "getSessionGrantConsent">,
  owner: string, epoch: string, expectedSigner?: string) {
  const proof = await db.getSessionGrantConsent(owner, epoch);
  if (!proof) throw new Error("Retained session ownership unavailable");
  const consent = parseSessionGrantConsent(proof.consent, ARC_MAINNET_PROFILE);
  if (consent.ownerAddr !== owner || consent.grantEpoch !== epoch || consent.origin !== mainnetGrantPolicy().origin ||
    (expectedSigner !== undefined && consent.sessAddr !== expectedSigner)) throw new Error("Retained session ownership refused");
  const recoveredOwner = await recoverMessageAddress({ message: createSessionGrantConsentMessage(consent, ARC_MAINNET_PROFILE), signature: proof.ownerSignature as Hex });
  const signer = await recoverMessageAddress({ message: createSessionGrantSignerProofMessage(consent, ARC_MAINNET_PROFILE), signature: proof.sessionSignature as Hex });
  if (recoveredOwner.toLowerCase() !== owner || signer.toLowerCase() !== consent.sessAddr) throw new Error("Retained session ownership refused");
  return { consent, ownerSignature: proof.ownerSignature, sessionSignature: proof.sessionSignature };
}
