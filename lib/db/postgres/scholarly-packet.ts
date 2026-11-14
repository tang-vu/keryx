import { canonicalJson } from '../../canonical-json';
import type { Source } from '../../types';
import { validateStorageIdentity,type StorageIdentity } from '../storage-identity';
import { PostgresStorageUnavailable } from './connection';

/** Actual enrolled Source behavior. Historical signed rights artifacts remain
 * historical; this closure never invokes an enrollment/review/signing issuer. */
export function selectedScholarlyState(source:Source|null):null {
 if(source?.scholarlyEnrolled)throw Error('Scholarly rights are unsupported on enrolled native storage');return null;
}
export function selectedScholarlyWrite(action:'enroll'|'submit'|'review'):never {
 throw Error(action==='review'?'Scholarly review is unsupported on enrolled native storage':'Scholarly enrollment is unsupported on enrolled native storage');
}
export function verifyScholarlyReadAuthority(raw:unknown,expected:StorageIdentity,digest:string):void {
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='identity,sourceDigest')throw new PostgresStorageUnavailable();const value=raw as Record<string,unknown>;
 if(value.sourceDigest!==digest||canonicalJson(validateStorageIdentity(value.identity))!==canonicalJson(expected))throw new PostgresStorageUnavailable();
}
