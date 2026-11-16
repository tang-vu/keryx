import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {canonicalPreparedNextSnapshot,isPreparedNextInstrumentationRefusal,preparedNextNegativeHealth,type PreparedNextMode} from './prepared-next-child.mts';

const prefix='An error occurred while loading instrumentation hook: ';
const response=(status=500,body='Internal Server Error',type='')=>({status,body:Buffer.from(body),type});
const expected:Partial<Record<PreparedNextMode,string>>={'wrong-identity':'PostgreSQL storage unavailable','wrong-source':'Storage identity refused: adapter_not_initialized','wrong-key':'Enrolled content cache unavailable','reader-credential':'PostgreSQL storage unavailable','held-target':'PostgreSQL storage unavailable'};

it('compares relation content independently of UNION result order without hiding changed or duplicate rows',()=>{
 const a={relation:'public.cache_items',rows:'1',digest:'a'.repeat(64)},b={relation:'keryx_storage.identity',rows:'1',digest:'b'.repeat(64)};
 expect(canonicalPreparedNextSnapshot([a,b])).toBe(canonicalPreparedNextSnapshot([b,a]));
 expect(canonicalPreparedNextSnapshot([a,b])).not.toBe(canonicalPreparedNextSnapshot([a,{...b,digest:'c'.repeat(64)}]));
 expect(()=>canonicalPreparedNextSnapshot([a,a])).toThrow();expect([a,b].map(row=>row.relation)).toEqual(['public.cache_items','keryx_storage.identity']);
});

it.each(Object.entries(expected))('classifies only the pinned cached Next prepare refusal for %s',(mode,message)=>{
 const args=['Failed to prepare server',new Error(prefix+message)];
 expect(isPreparedNextInstrumentationRefusal(mode as PreparedNextMode,args)).toBe(true);
 expect(preparedNextNegativeHealth(mode as PreparedNextMode,response(),true)).toBe('instrumentation');
});
it('refuses a status-only500, an unknown cause, extra logger args and an unprefixed storage error',()=>{
 expect(()=>preparedNextNegativeHealth('wrong-identity',response(),false)).toThrow();
 for(const args of [['Failed to prepare server',new Error(prefix+'unknown failure')],['Failed to prepare server',new Error('PostgreSQL storage unavailable')],['Failed to prepare server',new Error(prefix+expected['wrong-identity']),'extra'],['other logger',new Error(prefix+expected['wrong-identity'])]])expect(isPreparedNextInstrumentationRefusal('wrong-identity',args)).toBe(false);
});
it('refuses positive modes and cross-mode causes even with a matching500 body',()=>{
 for(const mode of ['verify','writer','restart','limits','oom','hang'] as const){expect(isPreparedNextInstrumentationRefusal(mode,['Failed to prepare server',new Error(prefix+expected['wrong-identity'])])).toBe(false);expect(()=>preparedNextNegativeHealth(mode,response(),true)).toThrow();}
 expect(isPreparedNextInstrumentationRefusal('wrong-key',['Failed to prepare server',new Error(prefix+expected['wrong-identity'])])).toBe(false);
});
it('requires the exact pinned Next fallback body and absent content type',()=>{
 for(const value of [response(500,'Internal Server Error\n'),response(500,'private error'),response(500,'Internal Server Error','text/plain'),response(502),response(200)])expect(()=>preparedNextNegativeHealth('wrong-identity',value,true)).toThrow();
});
it('preserves strict GET-reached503 JSON checks',()=>{
 expect(preparedNextNegativeHealth('wrong-identity',response(503,JSON.stringify({ok:false,db:'unreachable'}),'application/json'),false)).toBe('health');
 for(const body of ['not JSON',JSON.stringify({ok:true,db:'unreachable'}),JSON.stringify({ok:false,db:'ok'}),JSON.stringify({ok:false})])expect(()=>preparedNextNegativeHealth('wrong-identity',response(503,body),true)).toThrow();
});
it('does not read error getters or leak arbitrary error fields into classification',()=>{
 let reads=0;const error=new Error('private credential');Object.defineProperty(error,'message',{get(){reads++;throw Error('read');}});
 expect(isPreparedNextInstrumentationRefusal('wrong-identity',['Failed to prepare server',error])).toBe(false);expect(reads).toBe(0);
 const secret='do-not-publish-private-input';const result=isPreparedNextInstrumentationRefusal('wrong-identity',['Failed to prepare server',Object.assign(new Error(secret),{password:secret})]);expect(result).toBe(false);expect(JSON.stringify(result)).not.toContain(secret);
});
it('observes existing console.error only and never reenters prepare/register or modifies the app artifact',()=>{
 const source=readFileSync(new URL('./prepared-next-child.mts',import.meta.url),'utf8');
 expect(source).toContain("console.error=(...args:unknown[])=>{silence();");expect(source).toContain('unknownStartupRefusal=true');
 expect(source).not.toMatch(/\.register\s*\(|ensureInstrumentationRegistered\s*\(|\.prepare\s*\(/);
 expect(source).toContain('Rejected startup must not mutate the synthetic fixture');expect(source).toContain("if(!positive){assert(refusalAt!==null)");
});
