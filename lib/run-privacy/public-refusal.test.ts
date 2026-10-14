import type {DatabaseSync} from "node:sqlite";
import {NextRequest} from "next/server";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {SqliteAdapter} from "../db/sqlite-adapter";
import {RUN_PRIVACY_SQL} from "../db/run-privacy-sqlite";
import type {QueryRun} from "../types";
import type {TestnetArchiveStore} from "../history/testnet-archive";

const mocks=vi.hoisted(()=>{
  vi.stubEnv("BASE_URL","https://synthetic-privacy.example");
  vi.stubEnv("KERYX_FORCE_OFFLINE","1");
  vi.stubEnv("KERYX_NETWORK","arcTestnet");
  vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK","arcTestnet");
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","");
  return {db:vi.fn(),archive:vi.fn()};
});
vi.mock("@/lib/db",()=>({getDb:mocks.db}));
vi.mock("@/lib/auth",()=>({getSession:async()=>null}));
vi.mock("@/lib/history/testnet-archive",()=>({getTestnetArchive:mocks.archive}));

const wallet=`0x${"a".repeat(40)}`,createdAt="2026-10-11T00:00:00.000Z";
function run(id:string,asker?:string):QueryRun {
  return {id,asker,createdAt,question:`PROTECTED ${id} question`,answer:`PROTECTED ${id} answer`,
    budget:0.030001,engine:"fixture",totalSpent:0.012345,totalToCreators:0.000001,
    subClaims:[],decisions:[],trace:[],citations:[{marker:"S1",sourceId:"fixture-source",
      sourceName:"Fixture",weight:1,reward:0.000001,rationale:"Synthetic evidence"}]};
}
const originals=[run("private",wallet),run("unlisted")];
const connections:SqliteAdapter[]=[];
const connection=(adapter:SqliteAdapter)=>(adapter as unknown as {db:DatabaseSync}).db;

beforeEach(()=>{
  vi.resetModules();vi.resetAllMocks();
  vi.stubEnv("BASE_URL","https://synthetic-privacy.example");
  vi.stubEnv("KERYX_FORCE_OFFLINE","1");
  vi.stubEnv("KERYX_NETWORK","arcTestnet");
  vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK","arcTestnet");
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","");
});
afterEach(()=>{
  vi.restoreAllMocks();
  for(const adapter of connections.splice(0))adapter.close();
  vi.unstubAllEnvs();
});

async function ordinary(active:boolean,admitted=false) {
  // Only this test's in-memory ordinary adapter captures the synthetic flag.
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED",active?"true":"");
  const adapter=new SqliteAdapter(":memory:");connections.push(adapter);await adapter.init();
  if(admitted) {connection(adapter).exec(RUN_PRIVACY_SQL);await adapter.init();}
  for(const original of originals)await adapter.saveQueryRun(original);
  connection(adapter).prepare(`INSERT INTO payment_events
    (id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,settlement_status,rationale)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("synthetic-payment",createdAt,"citation","private","fixture-source","Fixture",
      wallet,`0x${"b".repeat(40)}`,0.000001,"eip155:5042002",0,"simulated","PROTECTED synthetic rationale");
  return adapter;
}
function snapshot(adapter:SqliteAdapter) {
  const db=connection(adapter);
  return {originals:db.prepare("SELECT * FROM query_runs ORDER BY id").all(),
    payments:db.prepare("SELECT * FROM payment_events ORDER BY id").all()};
}

it.each(["missing capability","storage read failure","database acquisition failure"] as const)(
  "refuses active public handlers after %s without reviving a primed legacy/archive original",async failure=>{
    const [cache,feed,runs,wanted,map,metadata,dispatch]=await Promise.all([
      import("../answers-archive-cache"),import("@/app/answers/feed.xml/route"),import("@/app/api/runs/route"),
      import("@/app/api/wanted/route"),import("@/app/sitemap"),import("@/app/dispatch/[id]/page"),
      import("@/app/api/dispatch/[id]/route"),
    ]);
    const legacy=await ordinary(false),legacyBefore=snapshot(legacy);
    const retained=[{...originals[0],answer:"PROTECTED immutable duplicate answer"},run("archive-only")];
    const archive={info:{network:"eip155:5042002" as const,label:"Arc testnet" as const,capturedAt:createdAt,
      sourceCommit:"a".repeat(40),databaseSha256:"b".repeat(64)},
      getQueryRun:vi.fn(async(id:string)=>retained.find(row=>row.id===id)??null),
      listRecentQueries:vi.fn(async()=>retained),
      iterateRecentQueries:vi.fn(async function*(){yield*retained;})
    } satisfies Pick<TestnetArchiveStore,"info"|"getQueryRun"|"listRecentQueries"|"iterateRecentQueries">;
    mocks.db.mockResolvedValue(legacy);mocks.archive.mockResolvedValue(archive);
    const primed=await cache.getArchiveCached();
    expect(primed.map(row=>row.id).sort()).toEqual(["archive-only","private","unlisted"]);
    expect(JSON.stringify(primed)).toContain(originals[0].question);
    expect(JSON.stringify(primed)).toContain(originals[0].answer);
    expect(JSON.stringify(primed)).toContain(originals[1].question);
    expect(JSON.stringify(primed)).toContain(originals[1].answer);
    expect(JSON.stringify(primed)).toContain("PROTECTED archive-only answer");
    expect(archive.iterateRecentQueries).toHaveBeenCalledWith(2500);

    const active=await ordinary(true,failure!=="missing capability"),before=snapshot(active);
    expect(active.runPrivacyActive).toBe(true);
    if(failure==="missing capability")expect(active.runPrivacy).toBeUndefined();
    else {
      expect((await active.runPrivacy!.owner("private",{wallet,binding:{network:"eip155:5042002",
        origin:"https://synthetic-privacy.example"}}))?.state.visibility).toBe("private");
      expect((await active.runPrivacy!.read("unlisted")).item?.state.visibility).toBe("unlisted");
    }
    mocks.db.mockResolvedValue(active);mocks.archive.mockClear();
    archive.getQueryRun.mockClear();archive.listRecentQueries.mockClear();archive.iterateRecentQueries.mockClear();
    // Real adapter list/iterator/dispatch paths run; only storage availability fails.
    const rawRun=vi.spyOn(active,"getQueryRun"),rawOffers=vi.spyOn(active,"listGapIntents");
    const storage=failure==="storage read failure"?vi.spyOn(connection(active),"prepare").mockImplementation(()=>{
      throw new Error("Synthetic privacy storage read failure");
    }):null;
    if(failure==="database acquisition failure")mocks.db.mockRejectedValue(new Error("Synthetic active database unavailable"));

    expect(await cache.getArchiveCached()).toEqual([]);
    const atom=await feed.GET(),atomText=await atom.text();
    expect(atom.status).toBe(200);expect(atom.headers.get("cache-control")).toBe("no-store");
    expect(atomText).not.toContain("<entry>");
    const sitemap=await map.default();
    expect(sitemap.some(row=>row.url.endsWith("/answers"))).toBe(true);
    expect(sitemap.filter(row=>row.url.includes("/dispatch/")||row.url.includes("/answers/topic/")||row.url.includes("/wanted/"))).toEqual([]);
    const history=await runs.GET();
    expect(history.status).toBe(503);expect(await history.json()).toEqual({error:"Question history unavailable"});
    const demand=await wanted.GET(new NextRequest("https://synthetic-privacy.example/api/wanted"));
    expect(demand.status).toBe(503);expect(await demand.json()).toEqual({error:"demand board unavailable"});
    const metadataResults=[];
    for(const id of ["private","unlisted","archive-only"]) {
      const params={params:Promise.resolve({id})};
      const result=await metadata.generateMetadata(params);metadataResults.push(result);
      // Unavailable metadata has its own catch contract, distinct from a missing ID.
      expect(result.robots).toEqual({index:false,follow:false});
      expect(result.description).toBeNull();expect(result.openGraph).toBeNull();
      expect(result.alternates).toEqual({canonical:null,languages:{},types:{}});
      const response=await dispatch.GET(new NextRequest(`https://synthetic-privacy.example/api/dispatch/${id}`),params);
      expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({error:"dispatch unavailable"});
    }
    expect(JSON.stringify({atomText,sitemap,metadataResults})).not.toContain("PROTECTED");
    expect(rawRun).not.toHaveBeenCalled();expect(rawOffers).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();expect(archive.getQueryRun).not.toHaveBeenCalled();
    expect(archive.listRecentQueries).not.toHaveBeenCalled();expect(archive.iterateRecentQueries).not.toHaveBeenCalled();
    if(storage) {expect(storage).toHaveBeenCalled();storage.mockRestore();}
    expect(snapshot(active)).toEqual(before);expect(snapshot(legacy)).toEqual(legacyBefore);
    // The held legacy copy remains intact; its presence did not authorize a fallback.
    expect(JSON.stringify(primed)).toContain("PROTECTED");
  });
