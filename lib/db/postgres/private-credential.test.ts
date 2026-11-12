import { afterEach,describe,it,expect } from 'vitest';
import { chmodSync,linkSync,mkdtempSync,rmSync,symlinkSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalJson } from '../../canonical-json';
import { readPrivatePostgresCredential } from './private-credential';
const folders:string[]=[];
afterEach(()=>{for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});
const packet=(role='keryx_reader')=>({format:'keryx-postgres-role-credential-v1',role,password:'synthetic-private-password'});
function fixture(value=canonicalJson(packet())){const folder=mkdtempSync(join(tmpdir(),'keryx-pg-private-')),target=join(folder,'reader.json');folders.push(folder);writeFileSync(target,value,{mode:0o600});return {folder,target};}
describe('Linux native private credential intake',()=>{
 it.runIf(process.platform!=='linux')('refuses an unsupported host before inspecting a credential path',()=>{expect(()=>readPrivatePostgresCredential('unopened-private-file','keryx_reader')).toThrow('PostgreSQL storage unavailable');});
 it.runIf(process.platform==='linux')('reads only the exact bounded canonical role credential',()=>{const f=fixture(),value=readPrivatePostgresCredential(f.target,'keryx_reader');expect(value.password).toBe(packet().password);expect(value.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(Object.isFrozen(value)).toBe(true);expect(()=>readPrivatePostgresCredential(f.target,'keryx_app')).toThrow();});
 it.runIf(process.platform==='linux')('rejects readable, hard-linked and symbolic credential files',()=>{const f=fixture();chmodSync(f.target,0o644);expect(()=>readPrivatePostgresCredential(f.target,'keryx_reader')).toThrow();chmodSync(f.target,0o600);const alias=join(f.folder,'alias');linkSync(f.target,alias);expect(()=>readPrivatePostgresCredential(f.target,'keryx_reader')).toThrow();rmSync(alias);symlinkSync(f.target,alias);expect(()=>readPrivatePostgresCredential(alias,'keryx_reader')).toThrow();});
 it.runIf(process.platform==='linux')('rejects duplicate keys, invalid UTF8 and oversized data',()=>{const f=fixture('{"format":"keryx-postgres-role-credential-v1","password":"synthetic-private-password","role":"keryx_app","role":"keryx_reader"}');expect(()=>readPrivatePostgresCredential(f.target,'keryx_reader')).toThrow();writeFileSync(f.target,Buffer.from([0xff,0xfe]));expect(()=>readPrivatePostgresCredential(f.target,'keryx_reader')).toThrow();writeFileSync(f.target,'x'.repeat(4097));expect(()=>readPrivatePostgresCredential(f.target,'keryx_reader')).toThrow();});
});
