import { z } from "zod";
import { keccak256, recoverMessageAddress, stringToHex, type Hex } from "viem";
import { canonicalJson } from "../canonical-json";
import { verifySessionWithdrawalPreparation, type SessionWithdrawalPreparation } from "./session-withdrawal-protocol";

const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
export const sessionWithdrawalAbortInput = z.object({ requestId: hash,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();
export const sessionWithdrawalAbortSchema = z.object({
  format: z.literal("keryx-session-withdrawal-publication-abort-v1"),
  network: z.literal("eip155:5042"), requestId: hash, preparationDigest: hash,
  ownerAddr: z.string().regex(/^0x[0-9a-f]{40}$/), sessAddr: z.string().regex(/^0x[0-9a-f]{40}$/),
  grantEpoch: z.string().uuid(), signature: sessionWithdrawalAbortInput.shape.signature,
}).strict();
export type SessionWithdrawalAbort = z.infer<typeof sessionWithdrawalAbortSchema>;

function statement(p: SessionWithdrawalPreparation) {
  return { format: "keryx-session-withdrawal-publication-abort-v1" as const, network: p.network,
    requestId: p.requestId, preparationDigest: keccak256(stringToHex(canonicalJson(p))),
    ownerAddr: p.ownerAddr, sessAddr: p.sessAddr, grantEpoch: p.grantEpoch };
}
/** Restricted holder assertion, not an independent proof of signature absence.
 * The trusted local signer must durably fence publication before signing this message. */
export function sessionWithdrawalAbortMessage(p: SessionWithdrawalPreparation) {
  return "Keryx: permanently abort this original withdrawal before publishing its burn signature.\n" + canonicalJson(statement(p));
}
export async function verifySessionWithdrawalAbort(value: unknown, preparation: SessionWithdrawalPreparation) {
  const p = await verifySessionWithdrawalPreparation(preparation), proof = sessionWithdrawalAbortSchema.parse(value);
  if (canonicalJson({ ...proof, signature: undefined }) !== canonicalJson({ ...statement(p), signature: undefined }) ||
    (await recoverMessageAddress({ message: sessionWithdrawalAbortMessage(p), signature: proof.signature as Hex })).toLowerCase() !== p.sessAddr)
    throw new Error("Original withdrawal abort proof refused");
  return proof;
}
export async function createSessionWithdrawalAbort(p: SessionWithdrawalPreparation, signature: string) {
  return verifySessionWithdrawalAbort({ ...statement(p), signature }, p);
}
