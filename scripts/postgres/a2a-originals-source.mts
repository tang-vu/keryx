/** Current Source package/profile constants, independently installed in fresh
 * databases. No new purchase, worker execution or installed facade authority. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { listA2aResearchPackages } from '../../lib/a2a/research-package-definition';
import { a2aResearchPackageFingerprint } from '../../lib/a2a/research-package';
import { nativeOwnerAssignmentsSource } from './owner-assignments-source.mts';
export function nativeA2aOriginalsSource(){
 const q=(value:unknown)=>"'"+JSON.stringify(value).replaceAll("'","''")+"'",profile={network:ARC_MAINNET_PROFILE.networkId,asset:ARC_MAINNET_PROFILE.usdcAddress.toLowerCase(),gatewayContract:ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase()},packages=listA2aResearchPackages().map(wire=>({wire,fingerprint:a2aResearchPackageFingerprint(wire)}));
 const base=nativeOwnerAssignmentsSource(),parts=['a2a-original-support.sql','a2a-originals.sql'].map(name=>readFileSync(new URL('../../ops/keryx-postgres/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n').replaceAll('__A2A_ORIGINAL_PROFILE__',q(profile)).replaceAll('__A2A_ORIGINAL_PACKAGES__',q(packages)));
 if(parts.some(part=>Buffer.byteLength(part)>32768)||packages.length>32)throw Error('A2A original SOURCE bound');
 const sql=base.sql+'\n'+parts.join('\n');return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Exact-original settlement/claim, execution checkpoints and bounded unfinished observation candidate only; Source/full-factory/owner-pending/load/cutover gates remain open.'});
}
