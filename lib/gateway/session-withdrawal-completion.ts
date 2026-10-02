import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { verifySessionWithdrawalPreparation, type SessionWithdrawalPreparation } from "./session-withdrawal-protocol";
import { validateWithdrawalRequest } from "./withdrawal-request";
import { withdrawalMintTermsSchema, matchWithdrawalMintTransaction } from "./withdrawal-mint-transaction";
import { validateRecordedMintObservation } from "./withdrawal-recorded-observation";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";

const schema = z.object({ format: z.literal("keryx-session-withdrawal-completion-v1"),
  network: z.literal("eip155:5042"), requestId: z.string().regex(/^0x[0-9a-f]{64}$/),
  ownerAddr: z.string().regex(/^0x[0-9a-f]{40}$/), sessAddr: z.string().regex(/^0x[0-9a-f]{40}$/),
  record: z.unknown(), attestation: z.unknown(), serializedTransaction: z.string().max(4098).regex(/^0x02(?:[a-fA-F0-9]{2})+$/),
  terms: withdrawalMintTermsSchema, observation: z.unknown() }).strict();

/** Recheck a retained original outcome, never a client claim of finality. Actual
 * canonical RPC inclusion is established by the server-owned observer before
 * insertion and independently by the worker before releasing its local barrier. */
export async function verifySessionWithdrawalCompletion(value: unknown, original: SessionWithdrawalPreparation) {
  const c = schema.parse(value), p = await verifySessionWithdrawalPreparation(original);
  const record = await validateWithdrawalRequest(c.record);
  if (c.requestId !== p.requestId || c.ownerAddr !== p.ownerAddr || c.sessAddr !== p.sessAddr ||
    record.id !== p.requestId || record.owner !== p.sessAddr || record.network !== p.network ||
    c.terms.relayer !== p.ownerAddr || canonicalJson(record.policy) !== canonicalJson(p.policy) ||
    canonicalJson(record.request.burnIntent) !== canonicalJson(p.burnIntent)) throw new Error("Original withdrawal completion refused");
  const attestation = await matchWithdrawalAttestation(record, c.attestation);
  const prepared = await matchWithdrawalMintTransaction(record, attestation, c.serializedTransaction, c.terms);
  const observation = validateRecordedMintObservation(c.observation, record, prepared);
  return { ...c, record, attestation, serializedTransaction: prepared.serializedTransaction, observation };
}
export type SessionWithdrawalCompletion = Awaited<ReturnType<typeof verifySessionWithdrawalCompletion>>;
