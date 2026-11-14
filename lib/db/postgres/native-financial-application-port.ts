import type { KeryxDB } from '../keryx-db';
import type { PostgresOwnerWithdrawalTransport } from './owner-withdrawal-transport';
import type { PostgresHostedAdmissionPort } from './hosted-admission-transport';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';

export type NativeFinancialApplicationPort = Pick<KeryxDB,
 'issueSessionGrantConsent'|'consumeSessionGrantConsent'|'getSessionGrantConsent'|
 'browserSignerRetainedSpendMicro'|'sessionFundingAccounting'|'browserSignerConfirmedSpendMicro'|
 'admitHostedTreasuryPolicy'|'hostedTreasuryAccounting'|'admitHostedAuthorization'|
 'submitHostedAuthorization'|'confirmHostedAuthorization'|
 'sessionWithdrawalAccounting'|'reserveSessionWithdrawal'|'getSessionWithdrawal'|
 'pendingSessionWithdrawal'|'getSessionWithdrawalSigningPhase'|'authorizeSessionWithdrawal'|
 'cancelSessionWithdrawal'|'getSessionWithdrawalAbort'|'abortSessionWithdrawal'|
 'getSessionWithdrawalCompletion'|'completeSessionWithdrawal'|
 'creatorOwnerWithdrawalAccounting'|'admitCreatorOwnerWithdrawal'|
 'getCreatorOwnerWithdrawalCompletion'|'completeCreatorOwnerWithdrawal'|
 'reserveCreatorWithdrawal'|'getCreatorWithdrawal'|'listCreatorWithdrawalHistory'|
 'claimCreatorWithdrawalTransfer'|'getCreatorWithdrawalTransferClaim'|
 'saveCreatorWithdrawalAttestation'|'getCreatorWithdrawalAttestation'>;

export type NativeFinancialApplicationTransport = Omit<PostgresOwnerWithdrawalTransport,'close'> & PostgresHostedAdmissionPort;

/** Application names over the existing fixed financial protocols. This creates
 * no installed facade or authority. The enclosing core supplies entry/current
 * authority guards; each underlying port captures inputs before its first await.
 * listSessionWithdrawalPayments remains an explicit integration gate in Core. */
export function composeNativeFinancialApplicationPort(
 transport:NativeFinancialApplicationTransport,readOnly:boolean,isClosed:()=>boolean,
):NativeFinancialApplicationPort {
 if(typeof readOnly!=='boolean'||typeof isClosed!=='function')throw new PostgresStorageUnavailable();
 const live=()=>{if(isClosed())throw new PostgresStorageUnavailable();};
 const method=<A extends unknown[],R>(write:boolean,fn:(...args:A)=>Promise<R>)=>async(...args:A):Promise<R>=>{
  live();if(write&&readOnly)throw new PostgresStorageUnavailable();
  // Call immediately: do not insert an authority await before the port captures
  // caller-owned originals, accounting baselines or signed completion proofs.
  const result=await fn.apply(transport,args);
  if(isClosed()){if(write)throw new PostgresDomainWriteOutcomeUnknown();throw new PostgresStorageUnavailable();}
  return result;
 };
 const funding=method(false,transport.sessionFundingAccounting);
 return Object.freeze({
  issueSessionGrantConsent:method(true,transport.issue),
  consumeSessionGrantConsent:method(true,transport.consume),
  getSessionGrantConsent:method(false,transport.get),
  browserSignerRetainedSpendMicro:method(false,transport.browserSignerRetainedSpend),
  sessionFundingAccounting:funding,
  async browserSignerConfirmedSpendMicro(signer:string){
   live();
   // Exact selected-mainnet SQLite branch; the fixed funding port validates the
   // address and safe-integer micro-USDC total. No historical-profile fallback.
   return Number((await funding(signer.toLowerCase())).confirmedSpentMicroUsdc);
  },
  admitHostedTreasuryPolicy:method(true,transport.admitHostedTreasuryPolicy),
  hostedTreasuryAccounting:method(false,transport.hostedTreasuryAccounting),
  admitHostedAuthorization:method(true,transport.admitHostedAuthorization),
  submitHostedAuthorization:method(true,transport.submitHostedAuthorization),
  confirmHostedAuthorization:method(true,transport.confirmHostedAuthorization),
  sessionWithdrawalAccounting:method(false,transport.sessionWithdrawalAccounting),
  reserveSessionWithdrawal:method(true,transport.reserveSessionWithdrawal),
  getSessionWithdrawal:method(false,transport.getSessionWithdrawal),
  pendingSessionWithdrawal:method(false,transport.pendingSessionWithdrawal),
  getSessionWithdrawalSigningPhase:method(false,transport.getSessionWithdrawalSigningPhase),
  authorizeSessionWithdrawal:method(true,transport.authorizeSessionWithdrawal),
  cancelSessionWithdrawal:method(true,transport.cancelSessionWithdrawal),
  getSessionWithdrawalAbort:method(false,transport.getSessionWithdrawalAbort),
  abortSessionWithdrawal:method(true,transport.abortSessionWithdrawal),
  getSessionWithdrawalCompletion:method(false,transport.getSessionWithdrawalCompletion),
  completeSessionWithdrawal:method(true,transport.completeSessionWithdrawal),
  creatorOwnerWithdrawalAccounting:method(false,transport.creatorOwnerWithdrawalAccounting),
  admitCreatorOwnerWithdrawal:method(true,transport.admitCreatorOwnerWithdrawal),
  getCreatorOwnerWithdrawalCompletion:method(false,transport.getCreatorOwnerWithdrawalCompletion),
  completeCreatorOwnerWithdrawal:method(true,transport.completeCreatorOwnerWithdrawal),
  reserveCreatorWithdrawal:method(true,transport.reserveCreatorWithdrawal),
  getCreatorWithdrawal:method(false,transport.getCreatorWithdrawal),
  listCreatorWithdrawalHistory:method(false,transport.listCreatorWithdrawalHistory),
  claimCreatorWithdrawalTransfer:method(true,transport.claimCreatorWithdrawalTransfer),
  getCreatorWithdrawalTransferClaim:method(false,transport.getCreatorWithdrawalTransferClaim),
  saveCreatorWithdrawalAttestation:method(true,transport.saveCreatorWithdrawalAttestation),
  getCreatorWithdrawalAttestation:method(false,transport.getCreatorWithdrawalAttestation),
 } satisfies NativeFinancialApplicationPort);
}
