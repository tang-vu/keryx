import { beforeAll,afterAll,expect,it,vi } from 'vitest';
import type { QueryRun } from '../../types';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
let p:typeof import('./private-research-packet');
beforeAll(async()=>{vi.stubEnv('KERYX_NETWORK','arc');vi.stubEnv('NEXT_PUBLIC_KERYX_NETWORK','arc');vi.resetModules();p=await import('./private-research-packet');});
afterAll(()=>vi.unstubAllEnvs());
it('captures private result JSON exactly before an asynchronous owner lookup',()=>{
 const run={id:'prv_'+'11'.repeat(32),question:'Synthetic private\0\ud800',budget:.03,researchMode:'quick',answer:'Private answer\0\udfff',nested:{value:'retained'}} as unknown as QueryRun;
 const captured=p.capturePrivateResearchValue('save-result',run) as string;run.question='changed';(run as unknown as {nested:{value:string}}).nested.value='changed';
 expect(JSON.parse(captured)).toMatchObject({question:'Synthetic private\0\ud800',answer:'Private answer\0\udfff',nested:{value:'retained'}});
});
it('captures normalized creator scalars without inventing fresh expiry or a payment proof',()=>{
 const raw={kind:'citation',sourceId:'Synthetic source\0\ud800',itemId:null,submission:{authorizationId:'0x'+'AB'.repeat(32),authorizationExpiresAt:'2020-01-01T07:00:00+07:00',payer:'0x'+'AB'.repeat(20),payee:'0x'+'CD'.repeat(20),amountMicros:'1',network:'eip155:5042',asset:ARC_MAINNET_PROFILE.usdcAddress.toLowerCase()}};
 const captured=p.capturePrivateResearchValue('admit-creator',raw) as typeof raw;raw.sourceId='changed';expect(captured.sourceId).toBe('Synthetic source\0\ud800');expect(captured.submission.authorizationExpiresAt).toBe('2020-01-01T07:00:00+07:00');
 expect(captured.submission.authorizationId).toBe('0x'+'ab'.repeat(32));expect(Object.isFrozen(captured.submission)).toBe(true);expect(p.privateCreatorLegId(captured as never)).toMatch(/^[a-f0-9]{64}$/);
});
it('rejects invalid policy/lookup input and keeps immutable policy capacity exact',()=>{
 expect(()=>p.privateResearchLookup('public-job','0x'+'11'.repeat(20))).toThrow();expect(()=>p.privateResearchLookup('prv_'+'11'.repeat(32),'')).toThrow();
 for(const capacityMicros of ['0','01','1000000000000'])expect(()=>p.capturePrivateResearchValue('reserve-treasury',{signer:'0x'+'11'.repeat(20),capacityMicros})).toThrow();
 expect(p.capturePrivateResearchValue('reserve-treasury',{signer:'0x'+'AB'.repeat(20),capacityMicros:'999999999999'})).toEqual({signer:'0x'+'ab'.repeat(20),capacityMicros:'999999999999'});
});
it('rejects leaked foreign-owner rows and metadata presented as a signed intent',async()=>{
 const key=p.privateResearchLookup('prv_'+'11'.repeat(32),'0x'+'11'.repeat(20)),wire={intentRowWire:null,paymentRowWire:null,executionRowWire:null,resultRowWire:null,interruptionRowWire:null,reservationRowWire:null,releaseRowWire:null,submissionsWire:'[]',confirmationsWire:'[]'};
 await expect(p.readPrivateResearchSnapshot({...wire,resultRowWire:'{}'},key)).rejects.toThrow();
 await expect(p.readPrivateResearchSnapshot({...wire,intentRowWire:JSON.stringify({id:key.id,payer:key.payer,data:'{"accepted":true}'})},key)).rejects.toThrow(/Invalid stored private research intent/);
 expect((await p.readPrivateResearchSnapshot(wire,key)).intent).toBeNull();
});
