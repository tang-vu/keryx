import type { SupabaseClient } from "@supabase/supabase-js";
import { describe,expect,it,vi } from "vitest";
import { createSupabaseRunPrivacy } from "../db/run-privacy-supabase";
import { type PrivacyActor } from "./contracts";
const wallet=`0x${"a".repeat(40)}`,actor:PrivacyActor={wallet,sessionHash:"a".repeat(64),binding:{network:"eip155:5042002",origin:"https://synthetic-privacy.example"}};
const run={id:"owned",createdAt:"2026-10-11T00:00:00.000Z",asker:wallet,question:"SECRET",answer:"SECRET answer",budget:0.1,engine:"heuristic",totalSpent:0.01,totalToCreators:0.001,subClaims:[],decisions:[],citations:[],trace:[]};
function fixture() {
  const from=vi.fn(),abortSignal=vi.fn(),rpc=vi.fn((_name:string,args:Record<string,unknown>)=>({abortSignal:(signal:AbortSignal)=>abortSignal(signal,args)}));
  const result=(value:unknown)=>abortSignal.mockImplementation(async(_signal,args)=>({data:{version:1,action:args.p_action,id:args.p_id,result:value},error:null}));
  return {store:createSupabaseRunPrivacy({rpc,from} as unknown as SupabaseClient),rpc,from,abortSignal,result};
}
describe("#266 Supabase bounded service-role privacy boundary",()=>{
  it.each(["private","unlisted","public"] as const)("binds %s reads and owner exports to the fixed admitted RPC",async visibility=>{
    const f=fixture(),state={visibility,revision:0,erased:false};f.result({exists:true,item:visibility==="private"?null:{run,state}});
    expect((await f.store.read(run.id)).item?.state.visibility??"hidden").toBe(visibility==="private"?"hidden":visibility);
    f.result({run,state});expect((await f.store.owner(run.id,actor))?.run).toEqual(run);
    const requestId="ee408752-6d6b-4b22-ad57-ece762c638a5";expect((await f.store.export(run.id,actor,requestId)).run).toEqual(run);
    expect(f.rpc).toHaveBeenLastCalledWith("run_privacy_v1",{p_action:"export",p_id:run.id,p_input:{requestId},p_actor:{...actor,sessionHash:null},p_claims:false});
    expect(f.abortSignal.mock.calls.every(call=>call[0] instanceof AbortSignal)).toBe(true);expect(f.from).not.toHaveBeenCalled();
  });
  it("requires interactive session hashes for defaults/visibility/erase and preserves idempotency inputs",async()=>{
    const f=fixture(),requestId="ee408752-6d6b-4b22-ad57-ece762c638a5";
    f.result("private");expect(await f.store.defaults(actor)).toBe("private");f.result("public");expect(await f.store.setDefault(actor,"public",requestId)).toBe("public");
    const mutation={visibility:"unlisted" as const,revision:2,requestId};f.result({visibility:"unlisted",revision:3,erased:false});expect(await f.store.change(run.id,actor,mutation)).toMatchObject({revision:3});
    expect(f.rpc).toHaveBeenLastCalledWith("run_privacy_v1",expect.objectContaining({p_actor:actor,p_input:mutation}));
    f.result({visibility:"private",revision:4,erased:true});expect(await f.store.erase(run.id,actor,{revision:3,requestId})).toMatchObject({erased:true});
    await expect(f.store.erase(run.id,{...actor,sessionHash:undefined},{revision:3,requestId})).rejects.toThrow();expect(f.from).not.toHaveBeenCalled();
  });
  it("rejects hidden list bodies, malformed/foreign/oversized responses and errors without REST fallback",async()=>{
    const f=fixture();f.result([{run,state:{visibility:"private",revision:0,erased:false}}]);await expect(f.store.list({take:1})).rejects.toThrow();
    f.result({exists:true,item:{run,state:{visibility:"private",revision:0,erased:false}}});await expect(f.store.read(run.id)).rejects.toThrow();
    f.result({run:{...run,id:"foreign"},state:{visibility:"private",revision:0,erased:false}});await expect(f.store.owner(run.id,actor)).rejects.toThrow();
    for(const error of ["not_found","unauthenticated","conflict","retention_hold","wrong_schema"]) {
      f.abortSignal.mockResolvedValue({data:null,error:{message:error}});await expect(f.store.erase(run.id,actor,{revision:0,requestId:"ee408752-6d6b-4b22-ad57-ece762c638a5"})).rejects.toMatchObject({code:error==="wrong_schema"?"privacy_unavailable":error});
    }
    expect(f.from).not.toHaveBeenCalled();
  });
});
