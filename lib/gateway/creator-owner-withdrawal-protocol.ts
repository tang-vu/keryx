import { z } from "zod";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { validateWithdrawalRequest } from "./withdrawal-request";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";
import { withdrawalMintTermsSchema, matchWithdrawalMintTransaction } from "./withdrawal-mint-transaction";
import { validateRecordedMintObservation } from "./withdrawal-recorded-observation";

const completionSchema = z.object({ format: z.literal("keryx-creator-owner-withdrawal-completion-v1"),
  network: z.literal("eip155:5042"), requestId: z.string().regex(/^0x[0-9a-f]{64}$/), ownerAddr: z.string().regex(/^0x[0-9a-f]{40}$/),
  record: z.unknown(), attestation: z.unknown(), serializedTransaction: z.string().max(4098).regex(/^0x02(?:[a-fA-F0-9]{2})+$/),
  terms: withdrawalMintTermsSchema, observation: z.unknown() }).strict();

/** Original tuple validation, not self-authenticating finality. The server obtains
 * the observation from its selected canonical RPC before insertion. */
export async function verifyCreatorOwnerWithdrawalCompletion(value: unknown) {
  const c = completionSchema.parse(value), record = await validateWithdrawalRequest(c.record);
  if (record.network !== ARC_MAINNET_PROFILE.networkId || record.id !== c.requestId || record.owner !== c.ownerAddr ||
    record.policy.recipient !== c.ownerAddr || c.terms.relayer !== c.ownerAddr) throw new Error("Original owner mint refused");
  const attestation = await matchWithdrawalAttestation(record, c.attestation);
  const prepared = await matchWithdrawalMintTransaction(record, attestation, c.serializedTransaction, c.terms);
  return { ...c, record, attestation, serializedTransaction: prepared.serializedTransaction,
    observation: validateRecordedMintObservation(c.observation, record, prepared) };
}
export type CreatorOwnerWithdrawalCompletion = Awaited<ReturnType<typeof verifyCreatorOwnerWithdrawalCompletion>>;
export interface CreatorOwnerWithdrawalAccounting {
  heldPaymentMicroUsdc: string; heldWithdrawalMicroUsdc: string;
  confirmedPaymentMicroUsdc: string; confirmedWithdrawalMicroUsdc: string;
}
