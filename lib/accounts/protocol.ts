import { createHash, randomBytes } from "node:crypto";
import { challengeSchema, digestSchema, type MembershipChallenge, type InteractiveSession } from "./contracts";

export const randomAccountValue = () => randomBytes(32).toString("hex");
export const accountDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export const membershipNonceHash = (nonce: string) => accountDigest(`keryx-account-membership-nonce-v1:${digestSchema.parse(nonce)}`);
export const sessionCommitment = (session: InteractiveSession, nonceHash: string) =>
  accountDigest(`keryx-account-session-commitment-v1:${session.sessionHash}:${session.issuedAt}:${session.expiresAt}:${nonceHash}`);
export const accountConsentHash = (purpose: MembershipChallenge["purpose"]) => accountDigest(purpose === "link-wallet"
  ? "keryx-account-consent-v1:share-past-and-future-owned-history:wallet-authority-stays-separate"
  : "keryx-account-consent-v1:create-private-account:share-owned-history");

/** Fixed-order UTF-8 personal_sign intent. Neither SIWE nor payment consent.
 * Raw login IDs, provider tokens and secrets are absent from this message. */
export function membershipMessage(raw: MembershipChallenge, nonce: string) {
  const c = challengeSchema.parse(raw); digestSchema.parse(nonce);
  return ["Keryx account membership only — v1", `Purpose: ${c.purpose}`, `Origin: ${c.binding.origin}`,
    `Domain: ${new URL(c.binding.origin).host}`, `Network: ${c.binding.network}`, `Account: ${c.accountId}`,
    `Wallet: ${c.wallet}`, `Membership revision: ${c.revision}`, `Membership generation: ${c.generation}`,
    `Session commitment: ${c.sessionCommitment}`, `Consent digest: ${c.consentHash}`, `Nonce: ${nonce}`,
    `Issued at: ${new Date(c.issuedAt).toISOString()}`, `Expires at: ${new Date(c.expiresAt).toISOString()}`,
    "I explicitly share this wallet's past and future owned history with this private account.",
    "Funds, payment limits, signing, API keys, claims and creator powers remain wallet bound.",
    "This signature authorizes no transaction, approval, payment or financial delegation."].join("\n");
}
