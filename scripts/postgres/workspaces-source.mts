import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativePrivacySource } from './privacy-source.mts';
export function nativeWorkspacesSource(){
 const base=nativePrivacySource(),addition=readFileSync(new URL('../../ops/keryx-postgres/workspaces.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(addition)>65536)throw new Error('Workspace SOURCE bound');const sql=base.sql+'\n'+addition;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Workspace protocol SOURCE candidate only. Current-domain/full-writer/data/factory/load and cutover gates remain required.'});
}
