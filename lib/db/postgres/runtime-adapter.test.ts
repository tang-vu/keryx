import { describe,it,expect } from 'vitest';
import { createPostgresRuntimeAdapter,createReadonlyPostgresRuntimeAdapter,assertPostgresRuntimeIdentity,closePostgresRuntimeAdapter } from './runtime-adapter';
describe('closed native runtime factory provenance',()=>{
 it('refuses injected construction/config/guard capabilities',async()=>{for(const factory of [createPostgresRuntimeAdapter,createReadonlyPostgresRuntimeAdapter])await expect(Reflect.apply(factory,undefined,[{identity:{},guard:async()=>{},transport:{}}])).rejects.toThrow('invalid_operation');});
 it('keeps application writers closed before reading target configuration',async()=>{await expect(createPostgresRuntimeAdapter()).rejects.toThrow('adapter_not_initialized');});
 it('does not accept fabricated or caller-wrapped facade provenance',async()=>{for(const value of [{},Object.freeze({guard:async()=>{},identity:{}}),new Proxy({},{get:()=>async()=>{}})]){await expect(assertPostgresRuntimeIdentity(value)).rejects.toThrow('adapter_not_initialized');expect(()=>closePostgresRuntimeAdapter(value)).toThrow('invalid_operation');}});
});
