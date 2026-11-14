import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeA2aOriginalsSource } from './a2a-originals-source.mts';
export function nativeHostedAdmissionSource(){
 const fields=[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}],domain=[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}];
 const q=(v:unknown)=>"'"+JSON.stringify(v).replaceAll("'","''")+"'";
 const base=nativeA2aOriginalsSource(),part=readFileSync(new URL('../../ops/keryx-postgres/hosted-admission.sql',import.meta.url),'utf8').replaceAll('\r\n','\n').replaceAll('__HOSTED_PAYMENT_TYPES__',q({TransferWithAuthorization:fields})).replaceAll('__HOSTED_DOMAIN_FIELDS__',q(domain));
 if(Buffer.byteLength(part)>32768)throw Error('Hosted admission SOURCE bound');
 const sql=base.sql+'\n'+part;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Unmanaged-source original hosted admission candidate only; managed-source policy, full writer, production pressure/startup/delta/cutover remain open.'});
}
