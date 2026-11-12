import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../storage-identity";
import { sessionWithdrawalFixture } from "../../gateway/session-withdrawal-test-fixture";
const state=vi.hoisted(()=>({query:vi.fn(),end:vi.fn(),pools:0}));
vi.mock("pg",()=>({Pool:class{
  constructor(){state.pools++;}query(...args:unknown[]){return state.query(...args);}end(){return state.end();}on(){}
},types:{getTypeParser:()=>(s:string)=>s}}));
import { createPostgresWithdrawalTransport } from "./withdrawal-transport";
import { PostgresStorageUnavailable } from "./connection";
import { PostgresDomainWriteOutcomeUnknown } from "./domain-channel";
const identity:StorageIdentity={format:"keryx-mainnet-storage-identity-v1",network:"eip155:5042",authorityMode:"mainnet-real",
  deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:"2026-11-12T00:00:00.000Z",profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:"11".repeat(32)};
const options={endpoint:{kind:"loopback" as const,port:5432},database:"synthetic",role:"keryx_app",password:"synthetic-not-a-live-secret"};
let p:Awaited<ReturnType<typeof sessionWithdrawalFixture>>;
const response=(v:unknown)=>({rows:[[v===null?null:JSON.stringify(v)]],fields:[{name:"result",dataTypeID:3802}]});
const snapshot=()=>({preparation:p,phase:"prepared",abort:null,completion:null});
const make=()=>createPostgresWithdrawalTransport(options,identity,"22".repeat(32));
beforeAll(async()=>{p=await sessionWithdrawalFixture();});
beforeEach(()=>{vi.clearAllMocks();state.pools=0;state.end.mockResolvedValue(undefined);state.query.mockResolvedValue(response(snapshot()));});
describe("original-bound native withdrawal transport",()=>{
  it("validates retained signatures and exact owner/request while sharing one pool",async()=>{
    const t=make();expect(await t.getSessionWithdrawal(p.requestId,p.ownerAddr)).toEqual(p);expect(state.pools).toBe(1);
    expect(state.query.mock.calls[0][0].text).toBe("SELECT public.storage_read_session_withdrawal($1::jsonb,$2::text,$3::text,$4::text) AS result");
    expect(state.query.mock.calls[0][0].values.slice(2)).toEqual([p.requestId,p.ownerAddr]);await t.close();
  });
  it("refuses poisoned or foreign original signatures before authority escapes",async()=>{
    const t=make();
    for(const changed of [{ownerAddr:`0x${"99".repeat(20)}`},{requestId:`0x${"99".repeat(32)}`},{authorization:{...p.authorization,ownerSignature:p.authorization.sessionSignature}}]){
      state.query.mockResolvedValue(response({...snapshot(),preparation:{...p,...changed}}));
      await expect(t.getSessionWithdrawal(p.requestId,p.ownerAddr)).rejects.toThrow(PostgresStorageUnavailable);
    }await t.close();
  });
  it("distinguishes absent original without issuing a transition",async()=>{
    const t=make();state.query.mockResolvedValue(response(null));expect(await t.authorizeSessionWithdrawal(p.requestId,p.ownerAddr)).toBeNull();
    expect(state.query).toHaveBeenCalledTimes(1);await t.close();
  });
  it.each(["completed","aborted_before_publication"])("requires the actual retained proof for phase %s",async phase=>{
    const t=make();state.query.mockResolvedValue(response({...snapshot(),phase}));
    await expect(t.getSessionWithdrawalSigningPhase(p.requestId,p.ownerAddr)).rejects.toThrow(PostgresStorageUnavailable);await t.close();
  });
  it("closes admission during asynchronous input verification without dispatching a write",async()=>{
    const t=make();const request=t.reserveSessionWithdrawal(p);const outcome=expect(request).rejects.toThrow(PostgresStorageUnavailable);
    await t.close();await outcome;expect(state.query).not.toHaveBeenCalled();
  });
  it("reports unknown after a submitted exposure loses its acknowledgement and never retries",async()=>{
    const t=make();state.query.mockResolvedValueOnce(response(snapshot())).mockRejectedValueOnce(new Error("private server detail"));
    await expect(t.authorizeSessionWithdrawal(p.requestId,p.ownerAddr)).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
    expect(state.query).toHaveBeenCalledTimes(2);expect(state.query.mock.calls[1][0].text).toContain("storage_expose_session_withdrawal");await t.close();
  });
  it("does not let malformed acknowledgement become another signing attempt",async()=>{
    const t=make();state.query.mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response({ok:true}));
    await expect(t.authorizeSessionWithdrawal(p.requestId,p.ownerAddr)).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);expect(state.query).toHaveBeenCalledTimes(2);await t.close();
  });
  it("verifies pending liability amounts against the original protocol",async()=>{
    const t=make(),totals={heldPaymentMicroUsdc:"100000",heldWithdrawalMicroUsdc:"501000",confirmedSpentMicroUsdc:"0"};
    state.query.mockResolvedValue(response({totals,preparations:[p]}));expect(await t.sessionWithdrawalAccounting(p.sessAddr)).toEqual(totals);
    state.query.mockResolvedValue(response({totals:{...totals,heldWithdrawalMicroUsdc:"0"},preparations:[p]}));
    await expect(t.sessionWithdrawalAccounting(p.sessAddr)).rejects.toThrow(PostgresStorageUnavailable);await t.close();
  });
  it("rejects invalid selectors before any native query",async()=>{
    const t=make();await expect(t.authorizeSessionWithdrawal("invalid",p.ownerAddr)).rejects.toThrow(PostgresStorageUnavailable);
    await expect(t.pendingSessionWithdrawal(p.ownerAddr,"invalid")).rejects.toThrow(PostgresStorageUnavailable);expect(state.query).not.toHaveBeenCalled();await t.close();
  });
  it("suppresses read results after terminal disposal across an await",async()=>{
    let finish!:(v:unknown)=>void;state.query.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const t=make();
    const request=t.getSessionWithdrawal(p.requestId,p.ownerAddr),outcome=expect(request).rejects.toThrow(PostgresStorageUnavailable);
    finish(response(snapshot()));const closing=t.close();await outcome;await closing;expect(state.end).toHaveBeenCalledTimes(1);
  });
});
