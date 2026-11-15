/** Pure independent Source bytes/closed-mode checks; no PostgreSQL, retained
 * Original, native factory admission or compiled-load claim. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {nativeCurrentProducersSource} from './current-producers-source.mts';
import {NATIVE_READONLY_RUNTIME_PROFILE,NATIVE_CURRENT_DATA_INTAKE_PROFILE,nativeMaterializationProfile} from '../../lib/db/postgres/runtime-profile';
import {supportsBrowserMaterialization} from './materialize-native-snapshot.mts';
import {hasPrivateResultIdentity} from './private-result-source.mts';
const mode='development-current510-data-only';
it('pins the independently measured current producer Source without reallocating505',()=>{
 expect(nativeCurrentProducersSource().sha256).toBe(NATIVE_CURRENT_DATA_INTAKE_PROFILE.sourceSqlSha256);
 expect(NATIVE_CURRENT_DATA_INTAKE_PROFILE).toMatchObject({sourceSqlSha256:'a4ea9909bc89c66e88ebb81f1095ea772d41acf3bdeb4f397d1f5802faaae2a5',catalogSha256:'6c5467e41bb119c5fe3b76a3b575c6715a723e5f3a55395a225586756db37e93',nativeFunctionCount:510,applicationFactoryApproved:false,genuineColdFactoryQualified:false,fullWriterQualified:false});
 expect(NATIVE_READONLY_RUNTIME_PROFILE).toEqual({format:'keryx-native-postgres-observation-profile-v1',digestFormat:'keryx-postgres17-jsonb-text-sha256-v1',sourceSqlSha256:'3d6d8b50e2241a8f1972501f15aec0619fbfafc07d5e1a468ee9daabcd4a9cff',catalogSha256:'3c6074ffdd9c2effc5fc59d09d650c643902e6238d8424fd37d5ee08e9b4580a'});
 expect(nativeMaterializationProfile()).toBe(NATIVE_READONLY_RUNTIME_PROFILE);expect(nativeMaterializationProfile(mode)).toBe(NATIVE_CURRENT_DATA_INTAKE_PROFILE);expect(Object.isFrozen(NATIVE_CURRENT_DATA_INTAKE_PROFILE)).toBe(true);
});
it.each(['current','510',NATIVE_CURRENT_DATA_INTAKE_PROFILE.catalogSha256,{},null])('refuses caller/target profile allocation %j',value=>{expect(()=>nativeMaterializationProfile(value as never)).toThrow('profile refused');});
it('does not infer current mode from a target descriptor or discard installed-shape checks',()=>{
 const current={sha256:NATIVE_CURRENT_DATA_INTAKE_PROFILE.catalogSha256,metadata:{sections:{relations:[],columns:[],constraints:[]}}} as never;
 expect(()=>supportsBrowserMaterialization(current)).toThrow();expect(()=>hasPrivateResultIdentity(current)).toThrow();expect(supportsBrowserMaterialization(current,mode)).toBe(false);expect(hasPrivateResultIdentity(current,mode)).toBe(false);
});
it('keeps real505 positive cold gates separate from the held current DATA refusal branch',()=>{
 const launcher=readFileSync(new URL('./qualify-native-materialization.mts',import.meta.url),'utf8'),cold=readFileSync(new URL('./native-materialized-cold-child.mts',import.meta.url),'utf8'),runtime=readFileSync(new URL('../../lib/db/postgres/runtime-adapter.ts',import.meta.url),'utf8');
 expect(launcher).toContain('--development-current-data-synthetic');expect(launcher).toContain('--development-current-data-retained');expect(launcher).toContain('if(!currentDataOnly)sql');expect(launcher).toContain("else console.log(JSON.stringify({format:'keryx-native-projection-and-cold-qualification-v1'");expect(launcher).toContain('compiled.length<=4194304');expect(launcher).toContain('coldCompiled.length<=16777216');
 expect(cold).toContain('--current-profile-refusal');expect(cold).toContain("error instanceof StorageIdentityRefused&&error.reason==='adapter_not_initialized'");expect(cold).toContain("stage='original-key-cold-factory'");expect(cold).toContain('genuineZeroArgumentReadonlyFactory:true');expect(cold).toContain('genuineColdFactoryQualified:false');expect(runtime).toContain('deployment.backend.sourceDigest!==NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256');expect(runtime).not.toContain('NATIVE_CURRENT_DATA_INTAKE_PROFILE');
});
