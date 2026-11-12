import { beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
import { nativeCreatorWithdrawalFixture } from '../../../scripts/postgres/withdrawal-fixtures';
const state=vi.hoisted(()=>({query:vi.fn(),end:vi.fn(),pools:0}));
vi.mock('pg',()=>({Pool:class{constructor(){state.pools++;}query(...a:unknown[]){return state.query(...a);}end(){return state.end();}on(){}},types:{getTypeParser:()=>(s:string)=>s}}));
import { createPostgresOwnerWithdrawalTransport } from './owner-withdrawal-transport';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),
  enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const options={endpoint:{kind:'loopback' as const,port:5432},database:'synthetic',role:'keryx_app',password:'synthetic-not-a-live-secret'};
const totals={heldPaymentMicroUsdc:'0',heldWithdrawalMicroUsdc:'0',confirmedPaymentMicroUsdc:'0',confirmedWithdrawalMicroUsdc:'0'};
const response=(v:unknown)=>({rows:[[v===null?null:JSON.stringify(v)]],fields:[{name:'result',dataTypeID:3802}]});
const make=()=>createPostgresOwnerWithdrawalTransport(options,identity,'22'.repeat(32));
let record:Awaited<ReturnType<typeof nativeCreatorWithdrawalFixture>>;
beforeAll(async()=>{record=await nativeCreatorWithdrawalFixture();});
beforeEach(()=>{vi.clearAllMocks();state.pools=0;state.end.mockResolvedValue(undefined);state.query.mockResolvedValue(response(null));});
describe('native creator owner liability boundary',()=>{
  it('checks exact integer liability fields over the composed single pool',async()=>{
    const t=make();state.query.mockResolvedValue(response(totals));expect(await t.creatorOwnerWithdrawalAccounting(record.owner)).toEqual(totals);
    expect(state.pools).toBe(1);expect(state.query.mock.calls[0][0].text).toContain('storage_creator_owner_accounting');await t.close();
  });
  it.each([null,{}, {...totals,extra:true},{...totals,heldWithdrawalMicroUsdc:0},{...totals,confirmedPaymentMicroUsdc:'9007199254740992'}].map(v=>({v})))(
    'refuses invalid retained liability $v',async({v})=>{const t=make();state.query.mockResolvedValue(response(v));await expect(t.creatorOwnerWithdrawalAccounting(record.owner)).rejects.toThrow(PostgresStorageUnavailable);await t.close();});
  it('snapshots the financial baseline before asynchronous signature verification',async()=>{
    const t=make(),before={...totals},request=t.admitCreatorOwnerWithdrawal(record,before,'1000000');before.heldPaymentMicroUsdc='99';
    expect(await request).toEqual(record);expect(JSON.parse(state.query.mock.calls[0][0].values[3])).toEqual(totals);await t.close();
  });
  it('keeps failed post-dispatch admission unknown without an automatic retry',async()=>{
    const t=make();state.query.mockRejectedValue(new Error('private database detail'));await expect(t.admitCreatorOwnerWithdrawal(record,totals,'1000000')).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
    expect(state.query).toHaveBeenCalledTimes(1);await t.close();
  });
  it('does not dispatch after disposal during signed original validation',async()=>{
    const t=make(),request=t.admitCreatorOwnerWithdrawal(record,totals,'1000000'),outcome=expect(request).rejects.toThrow(PostgresStorageUnavailable);
    await t.close();await outcome;expect(state.query).not.toHaveBeenCalled();
  });
});
