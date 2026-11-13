import type { KeryxDB } from '../keryx-db';
import type { PostgresRuntimeTransport } from './runtime-transport';
export type NativeFinancialObservation=Pick<KeryxDB,
 'getSessionGrantConsent'|'browserSignerRetainedSpendMicro'|'sessionFundingAccounting'|
 'sessionWithdrawalAccounting'|'getSessionWithdrawal'|'pendingSessionWithdrawal'|
 'getSessionWithdrawalCompletion'|'getSessionWithdrawalSigningPhase'|'getSessionWithdrawalAbort'|
 'listCreatorWithdrawalHistory'|'getCreatorWithdrawal'|'getCreatorWithdrawalTransferClaim'|
 'getCreatorWithdrawalAttestation'|'creatorOwnerWithdrawalAccounting'|
 'getCreatorOwnerWithdrawalCompletion'|'hostedTreasuryAccounting'>;
/** Fixed qualified observations on the existing channel. Construction conveys
 * no installed facade, financial mutation, policy renewal or signing authority. */
export function composeNativeFinancialObservation(transport:PostgresRuntimeTransport):NativeFinancialObservation{
 return Object.freeze({
  getSessionGrantConsent:transport.get.bind(transport),
  browserSignerRetainedSpendMicro:transport.browserSignerRetainedSpend.bind(transport),
  sessionFundingAccounting:transport.sessionFundingAccounting.bind(transport),
  sessionWithdrawalAccounting:transport.sessionWithdrawalAccounting.bind(transport),
  getSessionWithdrawal:transport.getSessionWithdrawal.bind(transport),
  pendingSessionWithdrawal:transport.pendingSessionWithdrawal.bind(transport),
  getSessionWithdrawalCompletion:transport.getSessionWithdrawalCompletion.bind(transport),
  getSessionWithdrawalSigningPhase:transport.getSessionWithdrawalSigningPhase.bind(transport),
  getSessionWithdrawalAbort:transport.getSessionWithdrawalAbort.bind(transport),
  listCreatorWithdrawalHistory:transport.listCreatorWithdrawalHistory.bind(transport),
  getCreatorWithdrawal:transport.getCreatorWithdrawal.bind(transport),
  getCreatorWithdrawalTransferClaim:transport.getCreatorWithdrawalTransferClaim.bind(transport),
  getCreatorWithdrawalAttestation:transport.getCreatorWithdrawalAttestation.bind(transport),
  creatorOwnerWithdrawalAccounting:transport.creatorOwnerWithdrawalAccounting.bind(transport),
  getCreatorOwnerWithdrawalCompletion:transport.getCreatorOwnerWithdrawalCompletion.bind(transport),
  hostedTreasuryAccounting:transport.hostedTreasuryAccounting.bind(transport),
 } satisfies NativeFinancialObservation);
}
