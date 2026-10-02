import { z } from "zod";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { pilotGrantFieldsSchema } from "./public-enrollment";
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const pilotItemSchema = z.object({ itemId: z.string().min(1).max(200), itemTitle: z.string().min(1).max(1000),
  itemUrl: z.string().url().max(2048), contentVersion: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  itemPublishedAt: z.string().max(100).optional(),
  contentReceipt: z.object({ deliveryKind: z.literal("full_text"), storageMode: z.literal("db_encrypted"),
    plaintextBytes: z.number().int().positive().max(262144), bodyHash: z.string().regex(/^0x[0-9a-f]{64}$/) }).strict(),
}).strict();
export const pilotItemPreviewSchema = z.object({ sourceId: z.string(), item: pilotItemSchema, payTo: addr,
  listPriceMicroUsdc: z.string().regex(/^[1-9]\d{0,5}$/) }).strict();
export const pilotGrantSchema = pilotGrantFieldsSchema.extend({ enrollmentDigest: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export const pilotChallengeSchema = z.object({
  enrollmentDigest: z.string().regex(/^[0-9a-f]{64}$/), ownerAddr: addr, sessAddr: addr,
  grantEpoch: z.string(), reqId: z.string().uuid(), sourceId: z.string().regex(/^0x[0-9a-f]{64}$/),
  kind: z.enum(["fetch", "citation"]), expectedNonce: z.string().regex(/^0x[0-9a-f]{64}$/),
  browserAuthorizationProtocol: z.literal("durable-v1"),
  requirements: z.object({ scheme: z.literal("exact"), network: z.literal(profile.networkId),
    asset: addr.refine(a => a.toLowerCase() === profile.usdcAddress.toLowerCase()),
    amount: z.string().regex(/^[1-9]\d{0,5}$/), payTo: addr,
    maxTimeoutSeconds: z.number().int().min(604900).max(691200),
    extra: z.object({ name: z.literal("GatewayWalletBatched"), version: z.literal("1"),
      verifyingContract: addr.refine(a => a.toLowerCase() === profile.gatewayWallet.toLowerCase()) }).strict(),
  }).strict(),
  paymentContext: z.object({ item: pilotItemSchema }).strict().optional(),
}).strict();
export type PilotBrowserRequest =
  | { type: "initialize"; owner: string }
  | { type: "derive"; signature: `0x${string}` }
  | { type: "restore"; blob: import("../session/isolated-session-vault").IsolatedWrappedKey }
  | { type: "bindGrant" }
  | { type: "sign"; reqId: string }
  | { type: "revoke" };
