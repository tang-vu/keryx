import { verifyMessage } from "viem";
import { AccountError, MEMBERSHIP_TTL_MS, accountConsentSchema, bindingSchema, digestSchema, interactiveSessionSchema,
  linkConsentSchema, preconditionSchema, walletInputSchema, type AccountBinding, type AccountConsent, type AccountMembershipStore,
  type AccountPrecondition, type AccountSnapshot, type InteractiveSession, type LinkConsent, type IssuedMembershipChallenge } from "./contracts";
import { accountConsentHash, accountDigest, membershipMessage, membershipNonceHash, randomAccountValue, sessionCommitment } from "./protocol";

/** No provider, RPC, signer, payment, account-ID selector or database fallback.
 * The caller supplies an already authenticated exact interactive wallet session. */
export function createAccountMembershipService(store: AccountMembershipStore, rawBinding: AccountBinding) {
  const binding = bindingSchema.parse(rawBinding);
  const resolve = (session: InteractiveSession) => store.resolve(interactiveSessionSchema.parse(session), binding);
  async function required(session: InteractiveSession, rawExpected: AccountPrecondition): Promise<AccountSnapshot> {
    const expected = preconditionSchema.parse(rawExpected), snapshot = await resolve(session);
    if (!snapshot) throw new AccountError("account_unauthenticated");
    if (snapshot.membership.accountId !== expected.accountId || snapshot.membership.revision !== expected.revision)
      throw new AccountError("account_changed");
    return snapshot;
  }
  async function prepare(session: InteractiveSession, purpose: "create-private-account" | "link-wallet", wallet: string, expected?: AccountPrecondition): Promise<IssuedMembershipChallenge> {
    session = interactiveSessionSchema.parse(session);
    const snapshot = await resolve(session);
    if (purpose === "create-private-account" && snapshot) throw new AccountError("account_changed");
    if (purpose === "link-wallet") await required(session, preconditionSchema.parse(expected));
    const nonce = randomAccountValue(), now = Date.now();
    const challenge = { version: 1 as const, purpose, accountId: purpose === "create-private-account" ? `acct_${randomAccountValue()}` : snapshot!.membership.accountId,
      revision: purpose === "create-private-account" ? 0 : snapshot!.membership.revision, wallet: walletInputSchema.parse(wallet),
      generation: randomAccountValue(), sessionCommitment: sessionCommitment(session, membershipNonceHash(nonce)),
      consentHash: accountConsentHash(purpose), binding, issuedAt: now, expiresAt: now + MEMBERSHIP_TTL_MS };
    await store.issue(session, challenge, membershipNonceHash(nonce));
    return { nonce, challenge, message: membershipMessage(challenge, nonce) };
  }
  return Object.freeze({
    resolve,
    offer(session: InteractiveSession) { return store.offer(interactiveSessionSchema.parse(session), binding); },
    async resume(session: InteractiveSession, expected: AccountPrecondition, consent: AccountConsent) {
      return store.resume(interactiveSessionSchema.parse(session), binding, preconditionSchema.parse(expected), accountConsentSchema.parse(consent));
    },
    async prepareCreate(session: InteractiveSession, consent: AccountConsent) {
      accountConsentSchema.parse(consent);
      return prepare(session, "create-private-account", session.wallet);
    },
    async prepareLink(session: InteractiveSession, wallet: string, expected: AccountPrecondition, consent: LinkConsent) {
      linkConsentSchema.parse(consent);
      return prepare(session, "link-wallet", wallet, expected);
    },
    async completeCreate(session: InteractiveSession, nonce: string, consent: unknown) {
      const taken = await store.take(session, binding, nonce, "create-private-account", randomAccountValue());
      accountConsentSchema.parse(consent); // Consumption precedes validation; no reusable declined attempt.
      return store.complete(session, taken, accountDigest(`keryx-account-bootstrap-v1:${taken.challenge.sessionCommitment}:${taken.challenge.consentHash}`));
    },
    async completeLink(session: InteractiveSession, nonce: string, signature: unknown, consent: unknown) {
      const taken = await store.take(session, binding, nonce, "link-wallet", randomAccountValue());
      try {
        linkConsentSchema.parse(consent);
        if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature) || !await verifyMessage({ address: taken.challenge.wallet as `0x${string}`,
          message: membershipMessage(taken.challenge, taken.nonce), signature: signature as `0x${string}` }))
          throw new Error("Invalid target EOA proof");
      } catch { throw new AccountError("invalid_membership_proof"); }
      // Awaited local cryptography does not preserve a stale initiating session or revision.
      return store.complete(session, taken, accountDigest(signature as string));
    },
    async unlink(session: InteractiveSession, expected: AccountPrecondition, wallet: string, generation: string, consent: true) {
      if (consent !== true) throw new AccountError("invalid_account_request");
      return store.unlink(await required(session, expected), walletInputSchema.parse(wallet), digestSchema.parse(generation));
    },
    async revokeSession(session: InteractiveSession, expected: AccountPrecondition) {
      return store.revokeSession(await required(session, expected));
    },
  });
}
