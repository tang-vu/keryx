/** Actual POST/x402/JWT/enrolled SQLite proof and durable port. The optional
 * async capability is a test-only composition around the genuine SQLite port;
 * this qualifies route wiring, never native installed proof/writer admission.
 * Vendor/readiness transports are synthetic and no payment is executed. */
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync,writeFileSync,readFileSync,lstatSync,existsSync,unlinkSync,rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll,beforeEach,afterEach,afterAll,expect,it,vi } from "vitest";
import { canonicalJson } from "../canonical-json";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST } from "../db/storage-identity";
import { installMainnetApplicationSchema } from "../db/mainnet-application-schema";
import { installNativeUserDomainSchema } from "../db/native-user-domain-schema";
import { insertStorageIdentity,installStorageFences } from "../db/storage-identity-sqlite";
import { createEnrolledSqliteAdapter } from "../db/enrolled-sqlite-adapter";
import { issueWebSession,parseWebSession,webSessionHash } from "../auth-session";
import type { PendingJobOwnersStore } from "../db/pending-job-owners-sqlite";
import type { PaidOptions } from "../x402-server";

const mocks=vi.hoisted(()=>({cookies:vi.fn(),db:vi.fn(),seller:vi.fn(),verify:vi.fn(),settle:vi.fn(),canary:vi.fn(),deps:vi.fn(),run:vi.fn()}));
vi.mock("next/headers",()=>({cookies:mocks.cookies}));
vi.mock("@/lib/config",async()=>{const {ARC_MAINNET_PROFILE:p}=await import("../arc-network-profile");return {config:{profile:p,networkId:p.networkId,sellerAddress:"0x2222222222222222222222222222222222222222",usdcAddress:p.usdcAddress,gatewayWallet:p.gatewayWallet,maxTimeoutSeconds:691200,a2aFeeUsdc:.02,a2aDeepFeeUsdc:.05,a2aMaxBudget:.5,defaultBudget:.05,botKey:"",jwtSecret:"unfunded-pending-route-fixture"}};});
vi.mock("@/lib/db",()=>({getDb:mocks.db}));
vi.mock("@/lib/agent",()=>({getAgentDeps:mocks.deps,collectRun:mocks.run}));
vi.mock("@/lib/payments/mainnet-hosted-gateway",()=>({assertMainnetHostedResearchReady:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@/lib/research/paid-admission",()=>({paidResearchAdmissionResponse:()=>null}));
vi.mock("@/lib/business-operator/canary-paid-admission",()=>({businessCanaryPaidAdmission:mocks.canary}));
vi.mock("@/lib/business-operator/canary-policy",()=>({canaryExecutionPaused:()=>false}));
vi.mock("@/lib/run-privacy/auth",()=>({requestPrivacyActor:async()=>undefined}));
vi.mock("@/lib/api-keys",()=>({verifyApiKey:vi.fn()}));
vi.mock("@/lib/rate-limit",()=>({checkRateLimit:async()=>null,clientIp:()=>"127.0.0.1"}));
vi.mock("@/lib/x402-discovery",()=>({a2aDiscovery:{}}));
vi.mock("@/lib/x402-server",()=>({settleThenServe:mocks.seller,challengeResponse:vi.fn()}));
vi.mock("@circle-fin/x402-batching/server",()=>({BatchFacilitatorClient:class{verify=mocks.verify;settle=mocks.settle;}}));

import { POST } from "../../app/api/agent/ask/route";
const cookie=new AsyncLocalStorage<string|undefined>(),wallet="0x"+"aa".repeat(20),secret="unfunded-pending-route-fixture";
let folder:string,file:string,manifestPath:string,manifest:string,contentKey:string,native:Awaited<ReturnType<typeof createEnrolledSqliteAdapter>>;
let seller:typeof import("../x402-server"),sequence=0,events:string[],held:boolean;
beforeAll(async()=>{
 folder=mkdtempSync(join(tmpdir(),"keryx-owner-route-"));file=join(folder,"source.sqlite");manifestPath=join(folder,"storage.json");contentKey=randomBytes(32).toString("hex");
 const identity={...syntheticStorageIdentity("mainnet-real"),format:"keryx-mainnet-storage-identity-v1" as const,network:"eip155:5042" as const,profileDigest:STORAGE_MAINNET_PROFILE_DIGEST};
 const setup=new DatabaseSync(file);try{setup.exec("BEGIN IMMEDIATE");installMainnetApplicationSchema(setup);installNativeUserDomainSchema(setup);insertStorageIdentity(setup,identity);installStorageFences(setup,identity);setup.exec("COMMIT");}finally{setup.close();}
 manifest=canonicalJson({format:"keryx-storage-deployment-v1",identity,backend:{kind:"sqlite",databasePath:file}});writeFileSync(manifestPath,manifest,{flag:"wx"});
 seller=await vi.importActual("../x402-server");
});
beforeEach(async()=>{
 vi.stubEnv("KERYX_FORCE_OFFLINE","0");vi.stubEnv("KERYX_STORAGE_MANIFEST",manifestPath);vi.stubEnv("KERYX_SQLITE_PATH",file);vi.stubEnv("CONTENT_MASTER_KEY",contentKey);
 expect(readFileSync(manifestPath,"utf8")).toBe(manifest);native=await createEnrolledSqliteAdapter();events=[];held=false;
 mocks.db.mockReset().mockResolvedValue(native);mocks.seller.mockReset().mockImplementation(seller.settleThenServe);mocks.deps.mockReset().mockResolvedValue({db:native,gateway:{},engine:{}});mocks.run.mockReset();
 mocks.cookies.mockImplementation(async()=>({get:(name:string)=>name==="keryx_session"&&cookie.getStore()?{value:cookie.getStore()}:undefined}));
 mocks.verify.mockReset().mockResolvedValue({isValid:true,payer:"0x"+"11".repeat(20)});
 mocks.settle.mockReset().mockImplementation(async()=>{events.push("provider");return {success:false,errorReason:"synthetic-no-debit"};});
 mocks.canary.mockReset().mockImplementation((input:{reserveSettlement?:boolean})=>{events.push(input.reserveSettlement?"reserve":"canary");return held?Response.json({error:"held"},{status:503}):null;});
});
afterEach(()=>{try{native?.close();}finally{vi.unstubAllEnvs();}});
afterAll(()=>{
 if(!folder)return;expect(lstatSync(folder).isSymbolicLink()).toBe(false);
 for(const path of [file,file+"-journal",file+"-wal",file+"-shm",manifestPath])if(existsSync(path)){expect(lstatSync(path).isFile()).toBe(true);unlinkSync(path);}rmdirSync(folder);
});
async function token(){return (await issueWebSession(native,secret,wallet,"asker")).token;}
function request(owned=true){
 const authorization={from:"0x"+"11".repeat(20),to:"0x"+"22".repeat(20),value:"50000",nonce:"0x"+(++sequence).toString(16).padStart(64,"0"),validAfter:"1",validBefore:"9999999999"};
 return new NextRequest("https://keryx.cc/api/agent/ask",{method:"POST",headers:{"content-type":"application/json",origin:"https://keryx.cc","payment-signature":Buffer.from(JSON.stringify({authorization,signature:"synthetic-vendor-only"})).toString("base64"),...(owned?{"x-keryx-account-job":"associate"}:{})},body:JSON.stringify({question:"Unfunded route admission fixture",budget:.03,researchMode:"quick",packageVersion:"1.0.0",responseMode:"async"})});
}
function options(){return mocks.seller.mock.calls[0][1] as PaidOptions;}
function composeAsync(wait:()=>Promise<void>,afterObservation?:()=>Promise<void>){
 const genuine=native.pendingJobOwners!;
 const port:PendingJobOwnersStore=Object.freeze({
  async assertAdmissionAsync(proof){events.push("async-start");await wait();genuine.assertAdmission(proof);events.push("async-current");await afterObservation?.();},
  assertAdmission(proof){events.push("sync-final");genuine.assertAdmission(proof);},list:genuine.list.bind(genuine),
 });
 // Only the route's ownerDb lookup receives this explicit protocol composition.
 // Cookie proof minting and all installed/financial calls use the genuine
 // factory handle. This object is never presented as installed provenance.
 const ownerDb=Object.freeze({pendingJobOwners:port,createOwnedA2aOrder:native.createOwnedA2aOrder.bind(native)});
 let reads=0;mocks.db.mockImplementation(async()=>++reads===3?ownerDb:native);
 return port;
}

it.each([false,true])("preserves ordinary SQLite options without an async hook (owned=%s)",async owned=>{
 const jwt=owned?await token():undefined,response=await cookie.run(jwt,()=>POST(request(owned)));
 expect(response.status).toBe(402);expect(Object.hasOwn(options(),"beforeSettlementAsync")).toBe(false);
 expect(typeof options().beforeSettlement).toBe("function");expect(mocks.settle).toHaveBeenCalledTimes(1);expect(events.slice(-2)).toEqual(["reserve","provider"]);expect(mocks.run).not.toHaveBeenCalled();
});
it("awaits optional durable admission then runs the final sync owner and reservation hooks before provider",async()=>{
 const jwt=await token();let release!:()=>void,started!:()=>void;
 const began=new Promise<void>(resolve=>{started=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});
 composeAsync(async()=>{started();await barrier;});
 const pending=cookie.run(jwt,()=>POST(request()));await began;expect(mocks.settle).not.toHaveBeenCalled();expect(events).not.toContain("reserve");
 release();expect((await pending).status).toBe(402);expect(typeof options().beforeSettlementAsync).toBe("function");
 expect(events.slice(-5)).toEqual(["async-current","canary","sync-final","reserve","provider"]);expect(mocks.settle).toHaveBeenCalledTimes(1);expect(mocks.run).not.toHaveBeenCalled();
});
it("refuses actual durable-session revocation while async admission waits",async()=>{
 const jwt=await token(),claims=(await parseWebSession(jwt,secret))!;let release!:()=>void,started!:()=>void;
 const began=new Promise<void>(resolve=>{started=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});
 composeAsync(async()=>{started();await barrier;});const pending=cookie.run(jwt,()=>POST(request()));await began;
 await native.revokeWebSession(webSessionHash(claims.jti),wallet);release();const response=await pending;
 expect(response.status).toBe(401);expect(response.headers.get("Cache-Control")).toBe("no-store");expect(await response.json()).toEqual({error:"Original account session unavailable"});
 expect(mocks.settle).not.toHaveBeenCalled();expect(events).not.toContain("reserve");expect(mocks.run).not.toHaveBeenCalled();
});
it("refuses a canary changed during the native-style wait before final reservation",async()=>{
 const jwt=await token();composeAsync(async()=>{held=true;});const response=await cookie.run(jwt,()=>POST(request()));
 expect(response.status).toBe(503);expect(events).toContain("async-current");expect(events).not.toContain("sync-final");expect(events).not.toContain("reserve");expect(mocks.settle).not.toHaveBeenCalled();
});
it("still checks the real durable session in the final synchronous hook after async observation",async()=>{
 const jwt=await token(),claims=(await parseWebSession(jwt,secret))!;composeAsync(async()=>{},()=>native.revokeWebSession(webSessionHash(claims.jti),wallet));
 const response=await cookie.run(jwt,()=>POST(request()));expect(response.status).toBe(401);
 expect(events).toContain("async-current");expect(events).toContain("sync-final");expect(events).not.toContain("reserve");expect(mocks.settle).not.toHaveBeenCalled();
});
