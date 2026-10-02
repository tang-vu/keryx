import { z } from "zod";
import { recoverTypedDataAddress, type Hex } from "viem";
import { canonicalJson } from "../canonical-json";
import {
  browserOriginalSourceContextSchema,
  browserSourceContextDigest,
  verifyRetainedBrowserOriginalSourceContext,
  type BrowserOriginalSourceContext,
} from "./browser-original-source-context";
import type { BrowserAuthorizationJournal } from "../db/browser-authorization-journal";
import {
  SESSION_CHAIN_ID,
  SESSION_GATEWAY,
} from "../session/session-signing-policy";

const decimal = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(78);
const address = z.string().regex(/^0x[0-9a-f]{40}$/);
export const browserSigningOriginalV2Schema = z
  .object({
    protocol: z.literal("durable-v2"),
    admittedAt: z.string().datetime(),
    namespace: z.string().regex(/^0x[0-9a-f]{64}$/),
    queryId: z.string().uuid(),
    requestId: z.string().min(1),
    grantEpoch: z.string().uuid(),
    domain: z
      .object({
        name: z.literal("GatewayWalletBatched"),
        version: z.literal("1"),
        chainId: z.literal(5042002),
        verifyingContract: z.literal(SESSION_GATEWAY.toLowerCase()),
      })
      .strict(),
    authorization: z
      .object({
        from: address,
        to: address,
        value: decimal,
        validAfter: decimal,
        validBefore: decimal,
        nonce: z.string().regex(/^0x[0-9a-f]{64}$/),
      })
      .strict(),
  })
  .strict();
export const browserSigningOriginalV3Schema = browserSigningOriginalV2Schema
  .extend({
    protocol: z.literal("durable-v3"),
    sourceContext: browserOriginalSourceContextSchema,
    sourceContextDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  })
  .strict();
export const browserSigningOriginalSchema = z.discriminatedUnion("protocol", [
  browserSigningOriginalV2Schema,
  browserSigningOriginalV3Schema,
]);
export type BrowserSigningOriginal = z.infer<
  typeof browserSigningOriginalSchema
>;
export function prepareBrowserSigningOriginal(
  journal: BrowserAuthorizationJournal,
  namespace: string
): z.infer<typeof browserSigningOriginalV2Schema> {
  const seconds = Math.floor(Date.parse(journal.admittedAt) / 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 600)
    throw new Error("Invalid original admission time");
  return browserSigningOriginalV2Schema.parse({
    protocol: "durable-v2",
    admittedAt: journal.admittedAt,
    namespace,
    queryId: journal.payment.queryId,
    requestId: journal.requestId,
    grantEpoch: journal.grantEpoch,
    domain: {
      name: "GatewayWalletBatched",
      version: "1",
      chainId: SESSION_CHAIN_ID,
      verifyingContract: SESSION_GATEWAY.toLowerCase(),
    },
    authorization: {
      from: journal.signer.toLowerCase(),
      to: journal.requirements.payTo.toLowerCase(),
      value: journal.requirements.amount,
      validAfter: String(seconds - 600),
      validBefore: String(seconds + journal.requirements.maxTimeoutSeconds),
      nonce: journal.nonce,
    },
  });
}
export function prepareBrowserSourceSigningOriginal(
  journal: BrowserAuthorizationJournal,
  namespace: string,
  sourceContext: BrowserOriginalSourceContext
): z.infer<typeof browserSigningOriginalV3Schema> {
  const bare = {
    ...prepareBrowserSigningOriginal(journal, namespace),
    protocol: "durable-v3" as const,
  };
  const captured = browserOriginalSourceContextSchema.parse(sourceContext);
  const seconds = Math.floor(Date.parse(journal.admittedAt) / 1000);
  if (
    journal.payment.kind !== "fetch" ||
    journal.payment.sourceId !== captured.source.sourceId ||
    journal.payment.itemId !== captured.item.itemId ||
    journal.payment.contentVersion !== captured.item.contentVersion ||
    (journal.payment.offerId ?? null) !==
      (captured.price.mode === "creator-offer"
        ? captured.price.offer.id
        : null) ||
    bare.authorization.to !== captured.registry.payoutWallet ||
    bare.authorization.value !== captured.price.amountMicros ||
    BigInt(captured.registry.blockTimestamp) > BigInt(seconds) ||
    (captured.price.mode === "creator-offer" &&
      captured.price.offer.expiresAt <= seconds)
  )
    throw new Error("Browser source context refused");
  return browserSigningOriginalV3Schema.parse({
    ...bare,
    sourceContext: captured,
    sourceContextDigest: browserSourceContextDigest(bare, captured),
  });
}
export async function verifyBrowserSigningOriginalSource(
  value: BrowserSigningOriginal,
  journal?: BrowserAuthorizationJournal
): Promise<void> {
  const original = browserSigningOriginalSchema.parse(value);
  if (original.protocol === "durable-v3") {
    const { sourceContext, sourceContextDigest, ...bare } = original;
    if (browserSourceContextDigest(bare, sourceContext) !== sourceContextDigest)
      throw new Error("Browser source context refused");
    await verifyRetainedBrowserOriginalSourceContext(
      sourceContext,
      original,
      journal
    );
  }
}
export function browserSigningTypedData(value: BrowserSigningOriginal) {
  const original = browserSigningOriginalSchema.parse(value),
    a = original.authorization;
  return {
    domain: {
      ...original.domain,
      verifyingContract: original.domain.verifyingContract as Hex,
    },
    primaryType: "TransferWithAuthorization" as const,
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    message: {
      ...a,
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
    },
  };
}
/** Canonical UTF-8/base64 header. Legacy headers must never pass through this serializer. */
export function serializeBrowserSigningHeader(
  value: BrowserSigningOriginal,
  signature: string
): string {
  const original = browserSigningOriginalSchema.parse(value);
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new Error("Invalid original signature");
  const text = canonicalJson({
    signature: signature.toLowerCase(),
    authorization: original.authorization,
  });
  return btoa(
    Array.from(new TextEncoder().encode(text), (byte) =>
      String.fromCharCode(byte)
    ).join("")
  );
}
/** Verify the exact original and canonical bytes before recording callback metadata. */
export async function verifyBrowserSigningHeader(
  value: BrowserSigningOriginal,
  header: string
) {
  const original = browserSigningOriginalSchema.parse(value);
  await verifyBrowserSigningOriginalSource(original);
  if (header.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header))
    throw new Error("Original header refused");
  const decoded = atob(header);
  if (btoa(decoded) !== header) throw new Error("Original header refused");
  const body = z
    .object({
      signature: z.string().regex(/^0x[0-9a-f]{130}$/),
      authorization: browserSigningOriginalV2Schema.shape.authorization,
    })
    .strict()
    .parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(decoded, (char) => char.charCodeAt(0))
        )
      )
    );
  if (
    canonicalJson(body.authorization) !==
      canonicalJson(original.authorization) ||
    serializeBrowserSigningHeader(original, body.signature) !== header ||
    (
      await recoverTypedDataAddress({
        ...browserSigningTypedData(original),
        signature: body.signature as Hex,
      })
    ).toLowerCase() !== original.authorization.from
  )
    throw new Error("Original header refused");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(header))
  );
  return {
    validAfter: original.authorization.validAfter,
    validBefore: original.authorization.validBefore,
    headerHash: Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}
