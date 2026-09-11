import { z } from "zod";
import { concatHex, encodePacked, keccak256, maxUint256, sliceHex, size, type Hex } from "viem";
import { validateWithdrawalRequest, type WithdrawalRequestRecord } from "./withdrawal-request";

// Circle's official evm-gateway-contracts, fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8:
// src/lib/{TransferSpec,TransferSpecLib,Attestations,AttestationLib}.sol.
// Single same-chain, empty-hook request only. Extra attestations are not authorized.
const SPEC_MAGIC = "0xca85def7", ATTESTATION_MAGIC = "0xff6fb334", SET_MAGIC = "0x1e12db71";
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)
  .pipe(z.string().refine(value => BigInt(value) > BigInt(0) && BigInt(value) <= maxUint256));
const responseSchema = z.object({
  transferId: z.string().uuid().transform(value => value.toLowerCase()),
  attestation: z.string().regex(/^0x(?:[a-fA-F0-9]{2})+$/).max(778).transform(value => value.toLowerCase() as Hex),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/).transform(value => value.toLowerCase() as Hex),
  expirationBlock: uint,
  success: z.literal(true).optional(), error: z.never().optional(),
});

function encodeSpec(record: WithdrawalRequestRecord) {
  const spec = record.request.burnIntent.spec;
  return concatHex([
    encodePacked(["bytes4", "uint32", "uint32", "uint32"], [SPEC_MAGIC, spec.version, spec.sourceDomain, spec.destinationDomain]),
    spec.sourceContract, spec.destinationContract, spec.sourceToken, spec.destinationToken,
    spec.sourceDepositor, spec.destinationRecipient, spec.sourceSigner, spec.destinationCaller,
    encodePacked(["uint256", "bytes32", "uint32"], [BigInt(spec.value), spec.salt, 0]),
  ]);
}

/** Caller must validate the request before using its spec identity as authority. */
export function withdrawalTransferSpecHash(record: WithdrawalRequestRecord) {
  return keccak256(encodeSpec(record));
}

export type WithdrawalAttestation = {
  format: "creator-withdrawal-attestation-v1";
  authority: "request-matched-only";
  requestId: Hex; transferId: string; transferSpecHash: Hex;
  expirationBlock: string; attestation: Hex; signature: Hex;
};

/** Structure/request binding only. The minter/signature, current block, transaction
 * receipt and chain finality require separate checks. No mint permission or payment
 * confirmation follows merely from storing a matching HTTP response. */
export async function matchWithdrawalAttestation(selected: WithdrawalRequestRecord, value: unknown): Promise<WithdrawalAttestation> {
  try {
    const response = responseSchema.parse(value);
    const record = await validateWithdrawalRequest(selected);
    const expected = encodeSpec(record);
    let payload = response.attestation;
    if (sliceHex(payload, 0, 4) === SET_MAGIC) {
      if (size(payload) !== 388 || sliceHex(payload, 4, 8) !== "0x00000001") throw new Error();
      payload = sliceHex(payload, 8);
    }
    if (size(payload) !== 380 || sliceHex(payload, 0, 4) !== ATTESTATION_MAGIC
      || BigInt(sliceHex(payload, 4, 36)).toString() !== response.expirationBlock
      || sliceHex(payload, 36, 40) !== "0x00000154"
      || sliceHex(payload, 40) !== expected) throw new Error();
    return { format: "creator-withdrawal-attestation-v1", authority: "request-matched-only",
      requestId: record.id, transferId: response.transferId, transferSpecHash: keccak256(expected),
      expirationBlock: response.expirationBlock, attestation: response.attestation, signature: response.signature };
  } catch { throw new Error("Withdrawal attestation unavailable"); }
}
