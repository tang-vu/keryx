import type { BrowserPaymentContext } from "./browser-cosign-gateway";
import type { SourcePaymentAuthority } from "./client-payto-allowlist";
import { validateArticleOfferProof } from "../offers/article-offer";

export type BrowserFetchPriceDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Last browser-side amount check before a user-funded bearer authorization is signed. */
export async function validateBrowserFetchPrice(args: {
  sourceId: string;
  amountUsdc6: string;
  authority: SourcePaymentAuthority;
  context?: BrowserPaymentContext;
}): Promise<BrowserFetchPriceDecision> {
  const { sourceId, authority, context } = args;
  let amountUsdc6: bigint;
  try {
    amountUsdc6 = BigInt(args.amountUsdc6);
  } catch {
    return { allowed: false, reason: "fetch amount is not an integer USDC value" };
  }
  if (!authority.active) return { allowed: false, reason: "source is inactive on-chain" };

  const ref = context?.offer;
  if (!ref) {
    const listUsdc6 = BigInt(Math.round(authority.listPriceUsdc * 1_000_000));
    return amountUsdc6 === listUsdc6 && listUsdc6 > BigInt(0)
      ? { allowed: true }
      : { allowed: false, reason: "fetch amount does not match the registry list price" };
  }

  const proof = ref.proof;
  const item = context?.item;
  if (!proof || !item) {
    return { allowed: false, reason: "article offer proof is incomplete" };
  }
  const validity = await validateArticleOfferProof({
    offer: proof,
    sourceId,
    itemId: item.itemId,
    contentVersion: item.contentVersion,
    expectedSigner: authority.creator,
    listPriceUsdc: authority.listPriceUsdc,
  });
  if (!validity.valid) return { allowed: false, reason: validity.reason };

  const sameReference =
    validity.ref.id === ref.id &&
    validity.ref.expiresAt === ref.expiresAt &&
    Math.abs(validity.ref.priceUsdc - ref.priceUsdc) < 0.0000005 &&
    Math.abs(validity.ref.listPriceUsdc - ref.listPriceUsdc) < 0.0000005;
  if (!sameReference) {
    return { allowed: false, reason: "article offer reference differs from its signed proof" };
  }
  if (amountUsdc6 !== BigInt(proof.priceUsdc6)) {
    return { allowed: false, reason: "fetch amount differs from the signed article offer" };
  }
  return { allowed: true };
}
