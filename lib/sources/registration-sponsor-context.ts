/** Shared sponsor context types; no server registration or storage initialization. */
import type { Hex,TransactionReceipt,TransactionSerializableEIP1559 } from "viem";
import type { KeryxDB } from "../db/keryx-db";
import type { ActiveRegistrationSponsorPolicy,RegistrationSponsorFundingObservation,RegistrationSponsorPolicy } from "./registration-sponsor-protocol";

export interface RegistrationSponsorChain {
  assertRegistry(): Promise<void>;
  registrationNonce(creator: Hex): Promise<bigint>;
  transactionNonce(): Promise<number>;
  estimateGas(data: Hex): Promise<bigint>;
  sign(transaction: TransactionSerializableEIP1559): Promise<Hex>;
  broadcast(raw: Hex): Promise<Hex>;
  receipt(hash: Hex): Promise<TransactionReceipt | null>;
  hasExpiredDeadline?(deadline: number): Promise<boolean>;
  fundingObservation?(): Promise<RegistrationSponsorFundingObservation>;
}
export interface RegistrationSponsorContext<P extends ActiveRegistrationSponsorPolicy = RegistrationSponsorPolicy> {
  db: KeryxDB; policy: P; chain: RegistrationSponsorChain;
  assertPolicy(): void; now?(): number;
}
