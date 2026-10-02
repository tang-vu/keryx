import { z } from "zod";
import {
  encodeAbiParameters,
  keccak256,
  sha256,
  stringToHex,
  type Hex,
} from "viem";
import { canonicalJson } from "../canonical-json";
import { validateArticleOfferProofMicros } from "../offers/article-offer-proof";
import type { BrowserSigningOriginal } from "./browser-signing-original";
import type { BrowserAuthorizationJournal } from "../db/browser-authorization-journal";

const id = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/);
const version = z.string().regex(/^[\x21-\x7e]{1,128}$/);
const digest = z.string().regex(/^0x[0-9a-f]{64}$/);
const address = z.string().regex(/^0x[0-9a-f]{40}$/);
const decimal = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(78);
const positive = decimal.refine(
  (value) =>
    BigInt(value) > BigInt(0) &&
    BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
);
const offer = z
  .object({
    id: digest,
    sourceId: id,
    itemId: id,
    contentVersion: version,
    priceUsdc6: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    signer: address,
    nonce: digest,
    signature: z.string().regex(/^0x[0-9a-f]{130}$/),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const BROWSER_SOURCE_CONTEXT_LIMIT = 6144;
export const browserOriginalSourceContextSchema = z
  .object({
    version: z.literal("source-context-v1"),
    service: z.literal("https://keryx.cc"),
    kind: z.literal("fetch"),
    source: z
      .object({
        sourceId: id,
        canonicalUrl: z.string().url().max(2048),
        registryId: digest,
      })
      .strict(),
    item: z.object({ itemId: id, contentVersion: version }).strict(),
    endpoint: z
      .object({ method: z.literal("GET"), path: z.string().min(1).max(2048) })
      .strict(),
    registry: z
      .object({
        network: z.literal("eip155:5042002"),
        contract: address,
        blockNumber: decimal,
        blockHash: digest,
        blockTimestamp: decimal,
        creator: address,
        payoutWallet: address,
        listPriceMicros: positive,
        active: z.literal(true),
      })
      .strict(),
    price: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("list"), amountMicros: positive }).strict(),
      z
        .object({
          mode: z.literal("creator-offer"),
          amountMicros: positive,
          offer,
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((context, issue) => {
    if (
      new TextEncoder().encode(canonicalJson(context)).byteLength >
      BROWSER_SOURCE_CONTEXT_LIMIT
    )
      issue.addIssue({
        code: "custom",
        message: "Source context exceeds bound",
      });
  });
export type BrowserOriginalSourceContext = z.infer<
  typeof browserOriginalSourceContextSchema
>;
export function browserSourceContextPath(
  context: BrowserOriginalSourceContext
): string {
  const params = new URLSearchParams({ version: context.item.contentVersion });
  if (context.price.mode === "creator-offer") {
    params.set("offer", context.price.offer.id);
    params.set("listPriceUsdc6", context.registry.listPriceMicros);
  }
  return `/api/source/${context.source.sourceId}/item/${encodeURIComponent(
    context.item.itemId
  )}?${params}`;
}
export function browserSourceRegistryId(creator: string, url: string): string {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [creator as Hex, keccak256(stringToHex(url))]
    )
  );
}
export function browserSourceContextDigest(
  original: Omit<
    BrowserSigningOriginal,
    "sourceContext" | "sourceContextDigest"
  >,
  sourceContext: BrowserOriginalSourceContext
): string {
  return sha256(stringToHex(canonicalJson({ original, sourceContext })));
}
/** Retained evidence is checked at original UTC only; this never performs a current RPC read. */
export async function verifyRetainedBrowserOriginalSourceContext(
  value: unknown,
  original: BrowserSigningOriginal,
  journal?: BrowserAuthorizationJournal
): Promise<BrowserOriginalSourceContext> {
  const context = browserOriginalSourceContextSchema.parse(value);
  const url = new URL(context.source.canonicalUrl);
  const originalSeconds = Math.floor(Date.parse(original.admittedAt) / 1000);
  if (
    !Number.isSafeInteger(originalSeconds) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href !== context.source.canonicalUrl ||
    browserSourceRegistryId(
      context.registry.creator,
      context.source.canonicalUrl
    ) !== context.source.registryId ||
    browserSourceContextPath(context) !== context.endpoint.path ||
    context.registry.payoutWallet !== original.authorization.to ||
    context.price.amountMicros !== original.authorization.value ||
    BigInt(context.registry.blockTimestamp) > BigInt(originalSeconds) ||
    (journal &&
      (journal.payment.kind !== "fetch" ||
        journal.payment.sourceId !== context.source.sourceId ||
        journal.payment.itemId !== context.item.itemId ||
        journal.payment.contentVersion !== context.item.contentVersion ||
        (journal.payment.offerId ?? null) !==
          (context.price.mode === "creator-offer"
            ? context.price.offer.id
            : null)))
  )
    throw new Error("Browser source context refused");
  if (context.price.mode === "list") {
    if (context.price.amountMicros !== context.registry.listPriceMicros)
      throw new Error("Browser source context refused");
  } else {
    const proof = context.price.offer;
    if (BigInt(proof.priceUsdc6) > BigInt(context.registry.listPriceMicros))
      throw new Error("Browser source context refused");
    const result = await validateArticleOfferProofMicros({
      offer: proof,
      sourceId: context.source.sourceId,
      itemId: context.item.itemId,
      contentVersion: context.item.contentVersion,
      expectedSigner: context.registry.creator,
      listPriceMicros: context.registry.listPriceMicros,
      nowSeconds: originalSeconds,
    });
    if (
      !result.valid ||
      String(proof.priceUsdc6) !== context.price.amountMicros
    )
      throw new Error("Browser source context refused");
  }
  function freeze(object: object): void {
    for (const child of Object.values(object))
      if (child && typeof child === "object") freeze(child);
    Object.freeze(object);
  }
  freeze(context);
  return context;
}
