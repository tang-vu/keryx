import type { KeryxDB } from '../keryx-db';
import type { PaperState,SignedPaperDeclaration,SignedPaperDecision } from '../../scholarly/rights-protocol';
import type { PaperAdmission } from '../scholarly-rights';
import { validateStorageIdentity,type StorageIdentity } from '../storage-identity';
import { PostgresStorageUnavailable } from './connection';
import type { PostgresDomainChannel } from './domain-channel';
import { selectedScholarlyState,selectedScholarlyWrite,verifyScholarlyReadAuthority } from './scholarly-packet';

export interface PostgresScholarlyPort {
 getPaperState(sourceId:string):Promise<PaperState|null>;
 beginPaperEnrollment(sourceId:string,creator:string):Promise<void>;
 submitPaper(submission:SignedPaperDeclaration):Promise<PaperState>;
 reviewPaper(review:SignedPaperDecision):Promise<PaperState>;
 getPaperAdmission(nonce:string):Promise<PaperAdmission|null>;
}
/** Parent passes composePostgresSourceClaims(channel), never the legacy
 * Supabase placeholder reader. This port does not enroll an installed facade. */
export function composePostgresScholarly(channel:PostgresDomainChannel,identity:StorageIdentity,digest:string,sourceClaims:Pick<KeryxDB,'getSource'>):PostgresScholarlyPort {
 const expected=validateStorageIdentity(identity),live=()=>{if(channel.closed)throw new PostgresStorageUnavailable();};
 if(expected.authorityMode!=='mainnet-real'||!/^[a-f0-9]{64}$/.test(digest)||typeof sourceClaims?.getSource!=='function')throw new PostgresStorageUnavailable();
 return Object.freeze({
  async getPaperState(sourceId){live();const source=await sourceClaims.getSource(sourceId);live();return selectedScholarlyState(source);},
  async beginPaperEnrollment(_sourceId,_creator){live();return selectedScholarlyWrite('enroll');},
  async submitPaper(_submission){live();return selectedScholarlyWrite('submit');},
  async reviewPaper(_review){live();return selectedScholarlyWrite('review');},
  async getPaperAdmission(_nonce){live();const raw=await channel.call('nativeRuntimeAuthority',[]);live();verifyScholarlyReadAuthority(raw,expected,digest);return null;},
 } satisfies PostgresScholarlyPort);
}
