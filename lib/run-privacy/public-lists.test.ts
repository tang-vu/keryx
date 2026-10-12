import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {NextRequest} from "next/server";
import {afterAll,afterEach,beforeEach,expect,it,vi} from "vitest";
import {installSqliteApplicationSchema} from "../db/sqlite-application-schema";
import {writeSqliteQueryRun} from "../db/query-run-record";
import {createSqliteRunPrivacy,RUN_PRIVACY_SQL} from "../db/run-privacy-sqlite";
const mocks=vi.hoisted(()=>{vi.stubEnv("BASE_URL","https://synthetic-privacy.example");return {db:vi.fn(),raw:vi.fn(()=>{throw Error("Broad original reads are forbidden");})};});
afterAll(()=>vi.unstubAllEnvs());
vi.mock("@/lib/db",()=>({getDb:mocks.db}));
vi.mock("@/lib/auth",()=>({getSession:async()=>null}));
vi.mock("@/lib/history/testnet-archive",()=>({getTestnetArchive:async()=>null}));
import {getArchiveCached} from "../answers-archive-cache";
import {buildTopics} from "../answers-topics";
import {relatedAnswers} from "../answers-archive";
import {GET as feed} from "@/app/answers/feed.xml/route";
import {GET as runs} from "@/app/api/runs/route";
import {GET as wanted} from "@/app/api/wanted/route";
import {generateMetadata} from "@/app/dispatch/[id]/page";
import sitemap from "@/app/sitemap";
const wallet=`0x${"a".repeat(40)}`,actor={wallet,sessionHash:"a".repeat(64),binding:{network:"eip155:5042002" as const,origin:"https://synthetic-privacy.example"}};
let db:DatabaseSync,store:ReturnType<typeof createSqliteRunPrivacy>;
beforeEach(async()=>{
  vi.clearAllMocks();db=new DatabaseSync(":memory:");installSqliteApplicationSchema(db);db.exec(RUN_PRIVACY_SQL);store=createSqliteRunPrivacy(db);
  const now=Date.now(),createdAt=new Date(now).toISOString();db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(actor.sessionHash,wallet,now-1000,now+60000);
  for(const id of ["private","unlisted","public"])writeSqliteQueryRun(db,{id,asker:wallet,createdAt,question:`${id.toUpperCase()} sentinel question`,answer:`${id.toUpperCase()} sentinel answer`,budget:0.1,engine:"fixture",totalSpent:0.012345,totalToCreators:0.000001,
    subClaims:[`${id.toUpperCase()} sentinel claim`],decisions:[],citations:[{marker:"S1",sourceId:"fixture-source",sourceName:"Fixture",weight:1,reward:0.000001,rationale:"Evidence"}],trace:[]},false);
  for(const visibility of ["public","unlisted"] as const)await store.change(visibility,actor,{visibility,revision:0,requestId:randomUUID()});
  mocks.db.mockResolvedValue({runPrivacy:store,getQueryRun:mocks.raw,listGapIntents:mocks.raw,listAllSources:async()=>[],
    listRecentQueries:(take:number)=>store.list({take}),async *iterateRecentQueries(take:number){yield*await store.list({take});}});
});
afterEach(()=>db.close());
async function publicSurfaces(){
  const entries=await getArchiveCached(),map=await sitemap();
  return {entries,topics:buildTopics(entries),related:relatedAnswers({id:"private",question:"sentinel question",sourceNames:[]},entries),
    feed:await(await feed()).text(),runs:await(await runs()).json(),wanted:await(await wanted(new NextRequest("https://synthetic-privacy.example/api/wanted"))).json(),
    dispatchUrls:map.filter(row=>row.url.includes("/dispatch/"))};
}
it("keeps each nonpublic visibility out of actual public API/feed/sitemap/archive/topic/search/demand paths before body retrieval",async()=>{
  const surfaces=await publicSurfaces(),text=JSON.stringify(surfaces);
  expect(surfaces.entries.map(row=>row.id)).toEqual(["public"]);expect(surfaces.runs.map((row:{id:string})=>row.id)).toEqual(["public"]);
  expect(surfaces.dispatchUrls).toHaveLength(1);expect(text).toContain("PUBLIC sentinel");
  expect(text).not.toContain("PRIVATE sentinel");expect(text).not.toContain("UNLISTED sentinel");expect(mocks.raw).not.toHaveBeenCalled();
});
it("revokes already-read public bodies without a stale public cache or financial counter rewrite",async()=>{
  const before=db.prepare("SELECT id,total_spent,total_to_creators FROM query_runs ORDER BY id").all();await publicSurfaces();
  await store.change("public",actor,{revision:1,visibility:"private",requestId:randomUUID()});
  const surfaces=await publicSurfaces();expect(surfaces.entries).toEqual([]);expect(surfaces.runs).toEqual([]);expect(surfaces.dispatchUrls).toEqual([]);
  expect(JSON.stringify(surfaces)).not.toContain("PUBLIC sentinel");expect(db.prepare("SELECT id,total_spent,total_to_creators FROM query_runs ORDER BY id").all()).toEqual(before);
});
it("omits question/answer metadata for private and unlisted links and matches unknown metadata",async()=>{
  const read=(id:string)=>generateMetadata({params:Promise.resolve({id})});
  expect(await read("private")).toEqual(await read("unknown"));expect(await read("unlisted")).toEqual(await read("unknown"));
  expect(JSON.stringify(await read("public"))).toContain("PUBLIC sentinel");
  await store.change("public",actor,{revision:1,visibility:"private",requestId:randomUUID()});expect(await read("public")).toEqual(await read("unknown"));
});
