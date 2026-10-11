import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabasePublicUsage } from "./public-usage-supabase";
import { newRunUsage, createTrustedUsageContext } from "../research/usage-provenance";
import { UsageUnavailable, usageWindow } from "../usage/contracts";
import type { RunPrivacyStore } from "../run-privacy/contracts";
import { createSupabaseRunPrivacy } from "./run-privacy-supabase";
import type { QueryRun } from "../types";
const window = usageWindow(new URLSearchParams(), "eip155:5042", new Date("2026-10-11T00:00:00.000Z"));
const wallet = `0x${"a".repeat(40)}`;
describe("ordinary Supabase public usage RPC", () => {
  it("counts a complete mixed published window beyond100 through real privacy RPC projection with exact financial parity",async()=>{
    const usage=newRunUsage({usageContext:createTrustedUsageContext(window.network,{actor:"outside",funding:"unknown",scripted:false,actorEvidenceSha256:"a".repeat(64)})},window.network,[]);
    const runs=Array.from({length:129},(_,i)=>({id:`run-${String(i).padStart(3,"0")}`,createdAt:"2026-10-01T00:00:00.000Z",usage,
      question:"PRIVATE question",answer:"PRIVATE answer",budget:0,engine:"fixture",totalSpent:0,totalToCreators:0,decisions:[],trace:[],citations:[],subClaims:[]} as QueryRun));
    const state=new Map(runs.map((run,i)=>[run.id,{visibility:i<125?"public":i===125?"private":"unlisted",revision:0,erased:i===128}]));
    const corpus={complete:true,window,runs:runs.map(run=>({id:run.id,createdAt:run.createdAt,usage,provenance:null,actorId:wallet})),
      payments:[{id:"exact-money",queryId:runs[125].id,network:window.network,kind:"fetch",amountUsdc:"0.000003",settled:true,settlementStatus:"settled",txHash:"original-circle-reference",payee:wallet}]};
    const from=vi.fn(),rpc=vi.fn((name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{
      if(name==="public_usage_window_v1")return {data:structuredClone(corpus),error:null};
      expect(name).toBe("run_privacy_v1");const input=args.p_input as {ids?:string[];take?:number};let result:unknown;
      if(args.p_action==="list")result=runs.filter(run=>input.ids!.includes(run.id)&&state.get(run.id)!.visibility==="public"&&!state.get(run.id)!.erased)
        .sort((a,b)=>b.id.localeCompare(a.id)).slice(0,input.take).map(run=>({run:structuredClone(run),state:state.get(run.id)}));
      else {expect(args.p_action).toBe("read");const run=runs.find(run=>run.id===args.p_id)!,current=state.get(run.id)!;
        result={exists:true,item:current.visibility==="private"||current.erased?null:{run:structuredClone(run),state:current}};}
      return {data:{version:1,action:args.p_action,id:args.p_id,result},error:null};
    }}));
    const client={rpc,from} as unknown as SupabaseClient,privacy=createSupabaseRunPrivacy(client),store=createSupabasePublicUsage(client,()=>privacy);
    const original=JSON.stringify(corpus),summary=await store.summary(window),first=await store.publishedHistory!(window,"outside",100);
    expect(first.windowRuns).toBe(125);expect(first.runs).toHaveLength(100);expect(first.runs[0].id).toBe("run-124");expect(first.runs.at(-1)!.id).toBe("run-025");
    expect(summary.columns[0]).toMatchObject({researchRuns:129,settledMicros:"3"});
    state.set("run-124",{visibility:"unlisted",revision:1,erased:false});
    const next=await store.publishedHistory!(window,"outside",100);expect(next.windowRuns).toBe(124);expect(next.runs[0].id).toBe("run-123");
    expect((await privacy.read("run-124")).item?.state.visibility).toBe("unlisted");
    expect(await store.summary(window)).toEqual(summary);expect(JSON.stringify(corpus)).toBe(original);expect(from).not.toHaveBeenCalled();
  });
  it("refuses inactive/missing public population and empty-window wrong-schema RPC instead of false success",async()=>{
    const client={from:vi.fn(),rpc:vi.fn(()=>({abortSignal:async()=>({data:{complete:true,window,runs:[],payments:[]},error:null})}))} as unknown as SupabaseClient;
    await expect(createSupabasePublicUsage(client).publishedHistory!(window,"outside",100)).rejects.toThrow();
    const privacy=createSupabaseRunPrivacy({rpc:vi.fn(()=>({abortSignal:async()=>({data:null,error:{message:"wrong_schema"}})}))} as unknown as SupabaseClient);
    await expect(createSupabasePublicUsage(client,()=>privacy).publishedHistory!(window,"outside",100)).rejects.toThrow("privacy_unavailable");
    expect(client.from).not.toHaveBeenCalled();
  });
  it("refuses missing/partial/misbound RPC with no native or paginated REST summary fallback", async () => {
    for (const result of [{ data: null, error: { code: "PGRST202" } }, { data: { complete: false }, error: null },
      { data: { complete: true, window: { ...window, network: "eip155:5042002" }, runs: [], payments: [] }, error: null }]) {
      const from = vi.fn(), abortSignal = vi.fn().mockResolvedValue(result), rpc = vi.fn(() => ({ abortSignal }));
      await expect(createSupabasePublicUsage({ rpc, from } as unknown as SupabaseClient).summary(window)).rejects.toThrow(UsageUnavailable);
      expect(rpc).toHaveBeenCalledWith("public_usage_window_v1", { p_window: window }); expect(from).not.toHaveBeenCalled();
    }
  });
  it("selects a classified complete-window page first, then refuses changed body cohort", async () => {
    const usage = newRunUsage({ usageContext: createTrustedUsageContext(window.network,
      { actor: "outside", funding: "unknown", scripted: false, actorEvidenceSha256: "a".repeat(64) }) }, window.network, []);
    const row = { id: "outside", createdAt: "2026-10-01T00:00:00.000Z", actorId: wallet, provenance: null, usage };
    const rpc = vi.fn(() => ({ abortSignal: vi.fn().mockResolvedValue({ data: { complete: true, window, runs: [row], payments: [] }, error: null }) }));
    const body = { id: row.id, created_at: row.createdAt, data: { id: row.id, createdAt: row.createdAt, usage } };
    const chain = { select: vi.fn(), in: vi.fn(), limit: vi.fn(), abortSignal: vi.fn() }; chain.select.mockReturnValue(chain); chain.in.mockReturnValue(chain); chain.limit.mockReturnValue(chain);
    chain.abortSignal.mockResolvedValue({ data: [body], error: null }); const from = vi.fn(() => chain);
    const list=vi.fn(async()=>[body.data]);
    const store = createSupabasePublicUsage({ rpc, from } as unknown as SupabaseClient,()=>({list} as unknown as RunPrivacyStore));
    expect(await store.history(window, "outside", 1)).toHaveLength(1); expect(list).toHaveBeenCalledWith({take:1,ids:["outside"]});expect(from).not.toHaveBeenCalled();
    body.data.usage = { ...usage, cohort: "unknown", actorEvidenceSha256: null };
    await expect(store.history(window, "outside", 1)).rejects.toThrow(UsageUnavailable);
  });
});
