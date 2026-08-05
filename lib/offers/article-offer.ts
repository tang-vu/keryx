import {
  keccak256,
  recoverTypedDataAddress,
  type Hex,
} from "viem";

import type {
  ArticleOffer,
  ArticleOfferRef,
  SourceItem,
} from "../types";
import { sourceItemContentVersion } from "../sources/source-item-asset";

export const ARTICLE_OFFER_CHAIN_ID = 5_042_002;
export const MIN_ARTICLE_OFFER_USDC6 = 100; // $0.000100
export const MAX_ARTICLE_OFFER_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MIN_ARTICLE_OFFER_TTL_SECONDS = 5 * 60;

export const ARTICLE_OFFER_DOMAIN = {
  name: "Keryx Article Offer",
  version: "1",
  chainId: ARTICLE_OFFER_CHAIN_ID,
} as const;

export const ARTICLE_OFFER_TYPES = {
  ArticleOffer: [
    { name: "sourceId", type: "string" },
    { name: "itemId", type: "string" },
    { name: "contentVersion", type: "string" },
    { name: "priceUsdc6", type: "uint256" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface ArticleOfferMessage {
  sourceId: string;
  itemId: string;
  contentVersion: string;
  priceUsdc6: number;
  expiresAt: number;
  nonce: Hex;
}

export function articleOfferTypedData(message: ArticleOfferMessage) {
  return {
    domain: ARTICLE_OFFER_DOMAIN,
    types: ARTICLE_OFFER_TYPES,
    primaryType: "ArticleOffer" as const,
    message: {
      sourceId: message.sourceId,
      itemId: message.itemId,
      contentVersion: message.contentVersion,
      priceUsdc6: BigInt(message.priceUsdc6),
      expiresAt: BigInt(message.expiresAt),
      nonce: message.nonce,
    },
  };
}

/** JSON-safe EIP-712 envelope for public offer-book clients. */
export function serializableArticleOfferTypedData(message: ArticleOfferMessage) {
  return {
    domain: ARTICLE_OFFER_DOMAIN,
    types: ARTICLE_OFFER_TYPES,
    primaryType: "ArticleOffer" as const,
    message: {
      ...message,
      priceUsdc6: String(message.priceUsdc6),
      expiresAt: String(message.expiresAt),
    },
  };
}

export function articleOfferId(signature: Hex): string {
  return keccak256(signature);
}

export async function recoverArticleOfferSigner(
  offer: Pick<
    ArticleOffer,
    | "sourceId"
    | "itemId"
    | "contentVersion"
    | "priceUsdc6"
    | "expiresAt"
    | "nonce"
    | "signature"
  >,
): Promise<string> {
  return recoverTypedDataAddress({
    ...articleOfferTypedData({
      sourceId: offer.sourceId,
      itemId: offer.itemId,
      contentVersion: offer.contentVersion,
      priceUsdc6: offer.priceUsdc6,
      expiresAt: offer.expiresAt,
      nonce: offer.nonce as Hex,
    }),
    signature: offer.signature as Hex,
  });
}

export type ArticleOfferValidity =
  | { valid: true; ref: ArticleOfferRef }
  | { valid: false; reason: string };

/**
 * Validate every field that can affect what the buyer signs. Call this during discovery and again
 * in the paid route so a stale/tampered row fails before a 402 challenge is issued.
 */
export async function validateArticleOffer(args: {
  offer: ArticleOffer;
  item: SourceItem;
  sourceId: string;
  expectedSigner: string;
  listPriceUsdc: number;
  nowSeconds?: number;
}): Promise<ArticleOfferValidity> {
  return validateArticleOfferProof({
    offer: args.offer,
    sourceId: args.sourceId,
    itemId: args.item.id,
    contentVersion: sourceItemContentVersion(args.item),
    expectedSigner: args.expectedSigner,
    listPriceUsdc: args.listPriceUsdc,
    nowSeconds: args.nowSeconds,
  });
}

/** Same validation over the immutable identity available to a browser co-signer. */
export async function validateArticleOfferProof(args: {
  offer: ArticleOffer;
  sourceId: string;
  itemId: string;
  contentVersion: string;
  expectedSigner: string;
  listPriceUsdc: number;
  nowSeconds?: number;
}): Promise<ArticleOfferValidity> {
  const { offer, itemId, contentVersion, sourceId, expectedSigner, listPriceUsdc } = args;
  const nowSeconds = args.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (offer.sourceId !== sourceId || offer.itemId !== itemId) {
    return { valid: false, reason: "offer does not belong to this article" };
  }
  if (offer.contentVersion !== contentVersion) {
    return { valid: false, reason: "offer targets a different article version" };
  }
  if (!Number.isSafeInteger(offer.priceUsdc6) || offer.priceUsdc6 < MIN_ARTICLE_OFFER_USDC6) {
    return { valid: false, reason: "offer price is below the supported x402 minimum" };
  }
  const listPriceUsdc6 = Math.round(listPriceUsdc * 1_000_000);
  if (offer.priceUsdc6 > listPriceUsdc6) {
    return { valid: false, reason: "offer price exceeds the registry list-price ceiling" };
  }
  if (!Number.isSafeInteger(offer.expiresAt) || offer.expiresAt <= nowSeconds) {
    return { valid: false, reason: "offer has expired" };
  }

  let recovered: string;
  try {
    recovered = await recoverArticleOfferSigner(offer);
  } catch {
    return { valid: false, reason: "offer signature is invalid" };
  }
  if (
    recovered.toLowerCase() !== expectedSigner.toLowerCase() ||
    offer.signer.toLowerCase() !== expectedSigner.toLowerCase()
  ) {
    return { valid: false, reason: "offer was not signed by the source creator" };
  }
  if (articleOfferId(offer.signature as Hex).toLowerCase() !== offer.id.toLowerCase()) {
    return { valid: false, reason: "offer id does not match its signature" };
  }

  return {
    valid: true,
    ref: {
      id: offer.id,
      priceUsdc: offer.priceUsdc6 / 1_000_000,
      listPriceUsdc,
      expiresAt: offer.expiresAt,
    },
  };
}

export function articleOfferQuery(offer?: ArticleOfferRef): string {
  return offer ? `&offer=${encodeURIComponent(offer.id)}` : "";
}
