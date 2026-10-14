import { describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { challengeSchema, type MembershipChallenge } from "./contracts";
import { accountConsentHash, membershipMessage, membershipNonceHash, sessionCommitment } from "./protocol";

// PUBLIC SYNTHETIC signer. Local cryptography only; no provider or custody.
const signer = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
const nonce = "b".repeat(64), sessionHash = "c".repeat(64);
const session = { sessionHash, wallet: signer.address.toLowerCase(), issuedAt: 1_000_000, expiresAt: 1_060_000 };
const c: MembershipChallenge = { version: 1, purpose: "link-wallet", accountId: `acct_${"a".repeat(64)}`, revision: 7,
  wallet: signer.address.toLowerCase(), generation: "d".repeat(64), binding: { origin: "https://keryx.example", network: "eip155:5042002" },
  sessionCommitment: sessionCommitment(session, membershipNonceHash(nonce)), consentHash: accountConsentHash("link-wallet"),
  issuedAt: 1_000_000, expiresAt: 1_300_000 };

describe("membership-only EOA proof protocol", () => {
  it("verifies only exact bytes from the independently controlled target wallet", async () => {
    const message = membershipMessage(c, nonce), signature = await signer.signMessage({ message });
    expect(await verifyMessage({ address: signer.address, message, signature })).toBe(true);
    for (const mutation of [{ ...c, revision: 8 }, { ...c, purpose: "create-private-account" as const },
      { ...c, accountId: `acct_${"e".repeat(64)}` }, { ...c, binding: { ...c.binding, network: "eip155:5042" as const } },
      { ...c, binding: { ...c.binding, origin: "https://other.example" } }, { ...c, sessionCommitment: "f".repeat(64) }]) {
      expect(await verifyMessage({ address: signer.address, message: membershipMessage(mutation, nonce), signature })).toBe(false);
    }
    expect(await verifyMessage({ address: signer.address, message: membershipMessage(c, "e".repeat(64)), signature })).toBe(false);
  });
  it("keeps login selectors out of the signing message and binds exact session times", () => {
    expect(membershipMessage(c, nonce)).not.toContain(sessionHash);
    expect(sessionCommitment({ ...session, sessionHash: "e".repeat(64) }, membershipNonceHash(nonce))).not.toBe(c.sessionCommitment);
    expect(sessionCommitment({ ...session, expiresAt: session.expiresAt + 1000 }, membershipNonceHash(nonce))).not.toBe(c.sessionCommitment);
    expect(membershipMessage(c, nonce)).toContain("authorizes no transaction, approval, payment or financial delegation");
  });
  it("rejects noncanonical wallet/origin/time, unknown provider labels and revision overflow", () => {
    for (const invalid of [{ ...c, wallet: signer.address }, { ...c, expiresAt: c.expiresAt + 1 },
      { ...c, binding: { ...c.binding, origin: "https://keryx.example/path" } }, { ...c, providerLabel: "Google" },
      { ...c, revision: Number.MAX_SAFE_INTEGER + 1 }]) expect(challengeSchema.safeParse(invalid).success).toBe(false);
  });
});
