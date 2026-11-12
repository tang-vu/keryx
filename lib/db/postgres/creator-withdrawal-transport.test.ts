import { beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from "../storage-identity";
import { sessionWithdrawalFixture } from "../../gateway/session-withdrawal-test-fixture";
import { headlessCashoutCompletion } from "../../../scripts/helpers/headless-cashout-test-fixture";
import { withdrawTypedData } from "../../gateway/withdraw-protocol";
const state=vi.hoisted(()=>({query:vi.fn(),end:vi.fn(),pools:0}));
vi.mock("pg",()=>({Pool:class{constructor(){state.pools++;}query(...a:unknown[]){return state.query(...a);}end(){return state.end();}on(){}},types:{getTypeParser:()=>(s:string)=>s}}));
import { createPostgresCreatorWithdrawalTransport } from "./creator-withdrawal-transport";
import { PostgresStorageUnavailable } from "./connection";
import { PostgresDomainWriteOutcomeUnknown } from "./domain-channel";
const identity:StorageIdentity={format:"keryx-mainnet-storage-identity-v1",network:"eip155:5042",authorityMode:"mainnet-real",deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),
  enrolledAt:"2026-11-12T00:00:00.000Z",profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:"11".repeat(32)};
const options={endpoint:{kind:"loopback" as const,port:5432},database:"synthetic",role:"keryx_app",password:"synthetic-not-a-live-secret"},digest="22".repeat(32),stamp="2026-11-12T00:00:00.000Z";
let fixture:Awaited<ReturnType<typeof headlessCashoutCompletion>>;
const response=(v:unknown)=>({rows:[[v===null?null:JSON.stringify(v)]],fields:[{name:"result",dataTypeID:3802}]});
const snapshot=()=>({record:fixture.completion.record,createdAt:stamp,claim:null,attestation:null});
const make=()=>createPostgresCreatorWithdrawalTransport(options,identity,digest);
beforeAll(async()=>{const p=await sessionWithdrawalFixture();fixture=await headlessCashoutCompletion(p,await privateKeyToAccount(`0x${"22".repeat(32)}`).signTypedData(withdrawTypedData(p.burnIntent)));});
beforeEach(()=>{vi.clearAllMocks();state.pools=0;state.end.mockResolvedValue(undefined);state.query.mockResolvedValue(response(snapshot()));});
describe("native creator withdrawal original/claim transport",()=>{
  it("verifies exact signed original and exposes no pool while composing all ports",async()=>{
    const t=make(),r=fixture.completion.record;expect(await t.getCreatorWithdrawal(r.id,r.owner)).toEqual(r);expect(state.pools).toBe(1);
    expect(state.query.mock.calls[0][0].text).toContain('storage_creator_withdrawal_read');expect(Object.keys(t)).not.toContain('query');await t.close();
  });
  it("refuses a foreign or mutated request before returning retained authority",async()=>{
    const t=make(),r=fixture.completion.record;
    state.query.mockResolvedValue(response({...snapshot(),record:{...r,owner:`0x${"99".repeat(20)}`}}));
    await expect(t.getCreatorWithdrawal(r.id,r.owner)).rejects.toThrow(PostgresStorageUnavailable);await t.close();
  });
  it("rejects a reply carrying another transfer claim as an unknown write",async()=>{
    const t=make(),r=fixture.completion.record;state.query.mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response({claimId:randomUUID(),startedAt:stamp}));
    await expect(t.claimCreatorWithdrawalTransfer(r.id,r.owner)).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);expect(state.query).toHaveBeenCalledTimes(2);await t.close();
  });
  it("keeps a repeated claim empty rather than granting a new initial transfer",async()=>{
    const t=make(),r=fixture.completion.record;state.query.mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response(null));
    expect(await t.claimCreatorWithdrawalTransfer(r.id,r.owner)).toBeNull();expect(state.query).toHaveBeenCalledTimes(2);await t.close();
  });
  it("reports lost claim acknowledgement without retry or private diagnostics",async()=>{
    const t=make(),r=fixture.completion.record;state.query.mockResolvedValueOnce(response(snapshot())).mockRejectedValueOnce(new Error('private detail'));
    await expect(t.claimCreatorWithdrawalTransfer(r.id,r.owner)).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);expect(state.query).toHaveBeenCalledTimes(2);await t.close();
  });
  it("preserves request-matched-only attestation semantics and requires the original claim",async()=>{
    const t=make(),r=fixture.completion.record,c={claimId:randomUUID(),startedAt:stamp};
    const row={claim_id:c.claimId,transfer_id:fixture.completion.attestation.transferId,data:fixture.completion.attestation,saved_at:stamp};
    state.query.mockResolvedValue(response({...snapshot(),claim:c,attestation:row}));
    expect(await t.getCreatorWithdrawalAttestation(r.id,r.owner)).toMatchObject({authority:'request-matched-only',requestId:r.id,savedAt:stamp});
    state.query.mockResolvedValue(response({...snapshot(),attestation:row}));await expect(t.getCreatorWithdrawalAttestation(r.id,r.owner)).rejects.toThrow(PostgresStorageUnavailable);await t.close();
  });
  it("closes admission during signed input validation without dispatching",async()=>{
    const t=make(),request=t.reserveCreatorWithdrawal(fixture.completion.record),outcome=expect(request).rejects.toThrow(PostgresStorageUnavailable);
    await t.close();await outcome;expect(state.query).not.toHaveBeenCalled();
  });
  it("rejects duplicate or out-of-cursor history rows instead of repeating metadata",async()=>{
    const t=make(),r=fixture.completion.record,row={id:r.id,owner:r.owner,created_at:stamp,data:r};
    state.query.mockResolvedValue(response([row,row]));await expect(t.listCreatorWithdrawalHistory(r.owner,undefined,2)).rejects.toThrow(PostgresStorageUnavailable);
    state.query.mockResolvedValue(response([row]));await expect(t.listCreatorWithdrawalHistory(r.owner,{createdAt:stamp,id:r.id},2)).rejects.toThrow(PostgresStorageUnavailable);await t.close();
  });
});
