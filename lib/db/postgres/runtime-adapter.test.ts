import { describe,it,expect } from 'vitest';
import { createPostgresRuntimeAdapter,createReadonlyPostgresRuntimeAdapter,assertPostgresRuntimeIdentity,assertPostgresRuntimeCurrentLocal,closePostgresRuntimeAdapter } from './runtime-adapter';
describe('native runtime factory provenance boundaries',()=>{
 it('refuses injected construction/config/guard capabilities',async()=>{for(const factory of [createPostgresRuntimeAdapter,createReadonlyPostgresRuntimeAdapter])await expect(Reflect.apply(factory,undefined,[{identity:{},guard:async()=>{},transport:{}}])).rejects.toThrow('invalid_operation');});
 it('keeps default and unselected application writers closed before target configuration',async()=>{await expect(createPostgresRuntimeAdapter()).rejects.toThrow('adapter_not_initialized');});
 it('does not accept fabricated or caller-wrapped facade provenance',async()=>{for(const value of [{},Object.freeze({guard:async()=>{},identity:{}}),new Proxy({},{get:()=>async()=>{}})]){await expect(assertPostgresRuntimeIdentity(value)).rejects.toThrow('adapter_not_initialized');expect(()=>closePostgresRuntimeAdapter(value)).toThrow('invalid_operation');}});
 it('never treats local method presence or injected entry hooks as installed provenance',()=>{
  let getters=0;const forged=new Proxy({entry:()=>{},guard:async()=>{},identity:{}},{get(){getters++;throw new Error('No facade getter may establish provenance');}});
  for(const value of [{},forged,Object.create(forged)])for(const access of ['read','write'] as const)
   expect(()=>assertPostgresRuntimeCurrentLocal(value,access)).toThrow('adapter_not_initialized');
  expect(getters).toBe(0);
  expect(()=>Reflect.apply(assertPostgresRuntimeCurrentLocal,undefined,[forged,'admin'])).toThrow('invalid_operation');
  expect(()=>Reflect.apply(assertPostgresRuntimeCurrentLocal,undefined,[forged,'read',async()=>{}])).toThrow('invalid_operation');
 });
});
