import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {SqliteAdapter} from "../db/sqlite-adapter";
import {SupabaseAdapter} from "../db/supabase-adapter";
import {RUN_PRIVACY_SQL} from "../db/run-privacy-sqlite";
import {privacyReadsActive,requirePrivacy} from "./contracts";
import {resolveDispatch} from "../history/read-dispatch";
import {listedQuestion,publicWantedOffers} from "./public";
import {newRunUsage,createTrustedUsageContext} from "../research/usage-provenance";
import {readFileSync,readdirSync} from "node:fs";
import {STORAGE_TESTNET_PROFILE_DIGEST} from "../db/storage-identity";
import {SUPABASE_RUNTIME_CONTRACT} from "../db/supabase-runtime-contract";
import {postgresBrowserMigrationProfiles} from "../../test-support/postgres-browser-migration-profiles";
const stub=vi.hoisted(()=>({client:vi.fn(),deployment:vi.fn()}));
vi.mock("@supabase/supabase-js",()=>({createClient:stub.client}));
vi.mock("../db/runtime-storage-config",()=>({readRuntimeStorageDeployment:stub.deployment}));
vi.mock("../history/testnet-archive",()=>({getTestnetArchive:async()=>null}));
afterEach(()=>{vi.unstubAllEnvs();stub.deployment.mockReset();});
const run={id:"existing",createdAt:"2026-10-11T00:00:00.000Z",question:"Existing question",answer:"Existing answer",budget:0.030001,
  engine:"fixture",totalSpent:0.012345,totalToCreators:0.000001,subClaims:[],decisions:[],citations:[],trace:[],
  usage:newRunUsage({usageContext:createTrustedUsageContext("eip155:5042002",{actor:"unknown",funding:"unknown",scripted:false})},"eip155:5042002",[])};
const memory={id:run.id,createdAt:run.createdAt,sourceScores:{},topics:["Existing topic"]};
it("keeps default-OFF SQLite selectors/link/receipt inputs/history/memory unchanged, with immutable stage and inactive controls",async()=>{
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","");
  const db=new SqliteAdapter(":memory:");
  try {
    await db.init();await db.saveQueryRun(run);await db.saveQueryMemory(memory);
    expect(privacyReadsActive(db)).toBe(false);expect(()=>requirePrivacy(db)).toThrow("privacy_unavailable");
    expect(Object.getOwnPropertyDescriptor(db,"runPrivacyActive")).toMatchObject({value:false,writable:false,configurable:false});
    expect(await db.listRecentQueries(1)).toEqual([run]);expect(await Array.fromAsync(db.iterateRecentQueries(1))).toEqual([run]);
    expect(await db.loadQueryMemories(1)).toEqual([{...memory,sourcesRead:undefined}]);
    expect((await resolveDispatch(run.id,db))?.run).toEqual(run);expect(await listedQuestion(db,run.id)).toBe(run.question);
    const window={network:"eip155:5042002" as const,since:"1970-01-01T00:00:00.000Z",until:"2026-11-01T00:00:00.000Z",period:"all" as const};
    const before=await db.publicUsage!.summary(window);expect(await db.publicUsage!.history(window,"default",1)).toEqual([run]);
    expect(await db.publicUsage!.summary(window)).toEqual(before);
    vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","true");expect(privacyReadsActive(db)).toBe(false);expect(await db.listRecentQueries(1)).toEqual([run]);
  } finally {db.close();}
});
it("never falls back to SQLite originals when captured ON lacks an admitted schema, including defaults/exports",async()=>{
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","true");const db=new SqliteAdapter(":memory:");
  try {
    await db.init();await db.saveQueryRun(run);expect(db.runPrivacy).toBeUndefined();
    vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","");expect(privacyReadsActive(db)).toBe(true);
    for(const read of [()=>db.listRecentQueries(1),()=>db.listFollowUps(run.id),()=>db.loadQueryMemories(1),()=>Array.fromAsync(db.iterateRecentQueries(1)),()=>resolveDispatch(run.id,db),()=>listedQuestion(db,run.id),()=>publicWantedOffers(db,1)])
      await expect(read()).rejects.toThrow("privacy_unavailable");
    expect(()=>requirePrivacy(db)).toThrow("privacy_unavailable");
  } finally {db.close();}
});
it("enforces ON visibility in admitted SQLite selectors while preserving exact financial fields",async()=>{
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","true");const db=new SqliteAdapter(":memory:");
  try {
    await db.init();const connection=(db as unknown as {db:DatabaseSync}).db;connection.exec(RUN_PRIVACY_SQL);await db.init();
    for(const id of ["private","linked","demo"]) {
      await db.saveQueryRun({...run,id,asker:`0x${"a".repeat(40)}`});await db.saveQueryMemory({...memory,id});
    }
    connection.prepare("UPDATE run_privacy SET visibility='unlisted' WHERE run_id='linked'").run();
    connection.prepare("UPDATE run_privacy SET visibility='public' WHERE run_id='demo'").run();
    expect((await db.listRecentQueries(10)).map(row=>row.id)).toEqual(["demo"]);
    expect((await Array.fromAsync(db.iterateRecentQueries(10))).map(row=>row.id)).toEqual(["demo"]);
    expect((await db.loadQueryMemories(10)).map(row=>row.id)).toEqual(["demo"]);
    expect(await resolveDispatch("private",db)).toBeNull();expect((await resolveDispatch("linked",db))?.run.answer).toBe(run.answer);
    for(const id of ["private","linked","demo"])expect(await requirePrivacy(db).settlement(id)).toMatchObject({budget:run.budget,totalSpent:run.totalSpent,totalToCreators:run.totalToCreators});
  } finally {db.close();}
});
it("preserves ordinary Supabase OFF table reads and uses only the sealed privacy RPC when ON",async()=>{
  let rows:unknown[]=[{data:run}],packet:unknown=null;
  const from=vi.fn(()=>{const builder:Record<string,unknown>={};for(const name of ["select","eq","order","limit","in","or","abortSignal"])builder[name]=vi.fn(()=>builder);
    builder.maybeSingle=vi.fn(async()=>({data:{data:run},error:null}));
    builder.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows,error:null}).then(resolve);return builder;});
  const rpc=vi.fn((_name:string,args:Record<string,unknown>)=>({abortSignal:async()=>({data:packet===null?null:{version:1,action:args.p_action,id:args.p_id,result:packet},error:packet===null?{message:"privacy_unavailable"}:null})}));
  stub.client.mockReturnValue({from,rpc});vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","");const off=new SupabaseAdapter();
  expect(await off.listRecentQueries(1)).toEqual([run]);expect(await off.listFollowUps(run.id)).toEqual([run]);expect((await resolveDispatch(run.id,off))?.run).toEqual(run);
  rows=[{id:memory.id,created_at:memory.createdAt,source_scores:{},topics:memory.topics,sources_read:null}];expect(await off.loadQueryMemories(1)).toEqual([{...memory,sourcesRead:undefined}]);
  expect(()=>requirePrivacy(off)).toThrow("privacy_unavailable");from.mockClear();rpc.mockClear();
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","true");const on=new SupabaseAdapter();
  await expect(on.listRecentQueries(1)).rejects.toThrow("privacy_unavailable");expect(from).not.toHaveBeenCalled();
  packet=[];expect(await on.listRecentQueries(1)).toEqual([]);expect(await on.loadQueryMemories(1)).toEqual([]);
  expect(from).not.toHaveBeenCalled();expect(rpc.mock.calls.every(([name])=>name==="run_privacy_v1")).toBe(true);
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","");expect(privacyReadsActive(on)).toBe(true);
});
it("keeps actual enrolled Supabase factory reflection sealed and binds private capture to the core in OFF/ON",async()=>{
  const {createEnrolledSupabaseAdapter,closeEnrolledSupabaseAdapter}=await import("../db/enrolled-supabase-adapter");
  for(const active of ["","true"]) {
    const identity={format:"keryx-storage-identity-v1",network:"eip155:5042002",authorityMode:"testnet-offline",
      deploymentId:crypto.randomUUID(),storageId:crypto.randomUUID(),enrollmentId:crypto.randomUUID(),
      enrolledAt:"2026-01-01T00:00:00.000Z",profileDigest:STORAGE_TESTNET_PROFILE_DIGEST,provenanceDigest:"0".repeat(64)};
    stub.deployment.mockReturnValue({format:"keryx-storage-deployment-v1",identity,backend:{kind:"supabase",url:"https://synthetic.invalid"}});
    const from=vi.fn(()=>{throw new Error("No ordinary table access on the enrolled facade");});
    const rpc=vi.fn((name:string)=>{
      const data=name==="read_storage_identity"?identity:name==="storage_inspect_runtime_readiness"?
        {format:"keryx-enrolled-runtime-readiness-v1",ready:true,sourceContractDigest:SUPABASE_RUNTIME_CONTRACT.afterDigest,cacheRows:[],cacheRowCount:0,cacheWireBytes:0}:
        name==="storage_verify_runtime_authority"?{format:"keryx-enrolled-runtime-authority-v1",ready:true,sourceContractDigest:SUPABASE_RUNTIME_CONTRACT.afterDigest}:[];
      const result=Promise.resolve({data,error:null});return Object.assign(result,{throwOnError:()=>result});
    });
    stub.client.mockReturnValue({rpc,from});vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED",active);
    const facade=await createEnrolledSupabaseAdapter();
    try {
      expect(Object.keys(facade)).toEqual([]);expect(Reflect.ownKeys(facade)).toEqual([]);
      expect(Object.getPrototypeOf(facade)).toBeNull();
      for(const key of ["runPrivacyActive","runPrivacy","constructor","#sb"]) {
        expect(Object.getOwnPropertyDescriptor(facade,key)).toBeUndefined();
        expect(()=>Reflect.get(facade,key)).toThrow();
        expect(Reflect.defineProperty(facade,key,{value:false})).toBe(false);
        expect(Reflect.deleteProperty(facade,key)).toBe(false);expect(Reflect.set(facade,key,false)).toBe(false);
      }
      expect(Reflect.setPrototypeOf(facade,{})).toBe(false);expect(Reflect.preventExtensions(facade)).toBe(false);
      vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED",active?"":"true");
      // The facade invokes the real method on the branded core, not on the Proxy.
      if(active)await expect(facade.listRecentQueries(1)).rejects.toThrow("privacy_unavailable");
      else expect(await facade.listRecentQueries(1)).toEqual([]);
      expect(from).not.toHaveBeenCalled();expect(rpc.mock.calls.every(([name])=>name==="read_storage_identity"||name.startsWith("storage_"))).toBe(true);
    } finally {closeEnrolledSupabaseAdapter(facade);}
  }
});
it("admits exactly ordinary privacy0090 while retaining the native chain and refusing future/duplicate migrations",()=>{
  const files=readdirSync("supabase/migrations"),profiles=postgresBrowserMigrationProfiles(files);
  expect(profiles.native).toEqual(files.filter(file=>/^\d{4}.*\.sql$/.test(file)&&Number(file.slice(0,4))<=85).sort());
  expect(profiles.extensions.find(item=>item.file==="0090_run_privacy.sql")).toEqual({file:"0090_run_privacy.sql",refusal:"privacy_unavailable"});
  expect(profiles.ordinary).not.toContain("0090_run_privacy.sql");
  expect(()=>postgresBrowserMigrationProfiles([...files,"0091_unreviewed.sql"])).toThrow("Unreviewed migration profile");
  expect(()=>postgresBrowserMigrationProfiles([...files,"0090_run_privacy.sql"])).toThrow("Duplicate migration identity");
  expect(readFileSync("supabase/migrations/0090_run_privacy.sql","utf8")).toContain("if to_regclass('keryx_storage.identity') is not null");
});
