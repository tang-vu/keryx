import { beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST,storageIdentityDigest,type StorageIdentity } from "../storage-identity";
import { hostedTreasuryPolicyDigest,type HostedTreasuryPolicy } from "../../payments/hosted-treasury-policy";
const state=vi.hoisted(()=>({query:vi.fn(),end:vi.fn(),pools:0}));
vi.mock('pg',()=>({Pool:class{constructor(){state.pools++;}query(...a:unknown[]){return state.query(...a);}end(){return state.end();}on(){}},types:{getTypeParser:()=>(s:string)=>s}}));
import { createPostgresHostedLedgerTransport } from './hosted-ledger-transport';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
import { PostgresStorageUnavailable } from './connection';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),
  enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const options={endpoint:{kind:'loopback' as const,port:5432},database:'synthetic',role:'keryx_app',password:'synthetic-not-a-live-secret'},signer=`0x${'aa'.repeat(20)}`,nonce=`0x${'bb'.repeat(32)}`;
const policy=():HostedTreasuryPolicy=>({format:'keryx-hosted-treasury-policy-v1',network:'eip155:5042',storageIdentityDigest:storageIdentityDigest(identity),origin:'https://keryx.cc',signer,
  lifetimeCapMicroUsdc:'100',queryCapMicroUsdc:'10',expiresAtSeconds:Math.floor(Date.now()/1000)+60});
const response=(v:unknown)=>({rows:[[v===null?null:JSON.stringify(v)]],fields:[{name:'result',dataTypeID:3802}]});
const make=()=>createPostgresHostedLedgerTransport(options,identity,'22'.repeat(32));
beforeEach(()=>{vi.clearAllMocks();state.pools=0;state.end.mockResolvedValue(undefined);state.query.mockResolvedValue(response(null));});
describe('closed native hosted ledger',()=>{
  it('binds policy identity/digest and composes one bounded pool',async()=>{
    const t=make(),p=policy();expect(await t.admitHostedTreasuryPolicy(p,'public')).toBe(hostedTreasuryPolicyDigest(p));expect(state.pools).toBe(1);
    const q=state.query.mock.calls[0][0];expect(q.text).toContain('storage_hosted_admit_policy');expect(JSON.parse(q.values[2])).toEqual(p);expect(q.values.slice(3)).toEqual([hostedTreasuryPolicyDigest(p),'public']);await t.close();
  });
  it('refuses expired/foreign policy before any write dispatch',async()=>{
    const t=make();await expect(t.admitHostedTreasuryPolicy({...policy(),expiresAtSeconds:1},'public')).rejects.toThrow();
    await expect(t.admitHostedTreasuryPolicy({...policy(),storageIdentityDigest:'00'.repeat(32)},'private')).rejects.toThrow();expect(state.query).not.toHaveBeenCalled();await t.close();
  });
  it.each([null,{},[],{retainedMicroUsdc:'1',confirmedMicroUsdc:'2'},{retainedMicroUsdc:'9007199254740992',confirmedMicroUsdc:'0'},{retainedMicroUsdc:1,confirmedMicroUsdc:'0'}].map(v=>({v})))(
    'rejects invalid or manufactured accounting $v',async({v})=>{const t=make();state.query.mockResolvedValue(response(v));await expect(t.hostedTreasuryAccounting(signer)).rejects.toThrow(PostgresStorageUnavailable);await t.close();});
  it('does not turn a failed reader into zero retained exposure or another attempt',async()=>{
    const t=make();state.query.mockRejectedValue(new Error('private database detail'));await expect(t.hostedTreasuryAccounting(signer,'public')).rejects.toThrow(/^PostgreSQL storage unavailable$/);
    expect(state.query).toHaveBeenCalledTimes(1);await t.close();
  });
  it('marks a lost confirmation acknowledgement unknown without retry',async()=>{
    const t=make();state.query.mockRejectedValue(new Error('private detail'));await expect(t.confirmHostedAuthorization(signer,nonce,'synthetic-confirmed')).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
    expect(state.query).toHaveBeenCalledTimes(1);await t.close();
  });
  it('suppresses policy authority when disposed after native dispatch',async()=>{
    let finish!:(v:unknown)=>void;state.query.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const t=make(),request=t.admitHostedTreasuryPolicy(policy(),'public');
    const outcome=expect(request).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);const closing=t.close();finish(response(null));await outcome;await closing;
  });
});
