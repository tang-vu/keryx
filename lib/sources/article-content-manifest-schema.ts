import { keccak256, type Hex } from "viem";

import type { ContentDeliveryKind } from "../types";

export const ARTICLE_CONTENT_MANIFEST_CHAIN_ID = 5_042_002;

export const ARTICLE_CONTENT_MANIFEST_DOMAIN = {
  name: "Keryx Article Content",
  version: "1",
  chainId: ARTICLE_CONTENT_MANIFEST_CHAIN_ID,
} as const;

export const ARTICLE_CONTENT_MANIFEST_TYPES = {
  ArticleContent: [
    { name: "sourceId", type: "string" },
    { name: "itemId", type: "string" },
    { name: "canonicalUrl", type: "string" },
    { name: "bodyHash", type: "bytes32" },
    { name: "plaintextBytes", type: "uint64" },
    { name: "deliveryKind", type: "string" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface ArticleContentManifestMessage {
  sourceId: string;
  itemId: string;
  canonicalUrl: string;
  bodyHash: Hex;
  plaintextBytes: number;
  deliveryKind: ContentDeliveryKind;
  nonce: Hex;
}

export function articleContentManifestTypedData(message: ArticleContentManifestMessage) {
  return {
    domain: ARTICLE_CONTENT_MANIFEST_DOMAIN,
    types: ARTICLE_CONTENT_MANIFEST_TYPES,
    primaryType: "ArticleContent" as const,
    message: {
      ...message,
      plaintextBytes: BigInt(message.plaintextBytes),
    },
  };
}

export function articleContentManifestId(signature: Hex): string {
  return keccak256(signature);
}

