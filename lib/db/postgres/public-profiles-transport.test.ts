import { expect,it,vi } from 'vitest';
import { composePostgresPublicProfiles,projectPostgresPublicProfile } from './public-profiles-transport';
import { recordedMicros } from '../../profiles/public-profile-projection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const wallet='0x'+'ab'.repeat(20),actor={wallet,sessionHash:'ab'.repeat(32),binding:{network:'eip155:5042' as const,origin:'https://keryx.cc'}},date='2026-11-13T00:00:00.000Z';
const fields=()=>({version:1,handle:'researcher',publishedAt:date,ownershipBasis:'signed-wallet-publication-existing-run-proof'});
const packet=()=>({profile:fields(),runs:[],ledger:[]});
function fixture(readOnly=false){let closed=false;const call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={get closed(){return closed;},call,async close(){closed=true;}};return {call,channel,port:composePostgresPublicProfiles(channel,readOnly)};}
it('refuses readonly writes before input getters and IO',async()=>{const f=fixture(true);let getters=0;const bad={get wallet(){getters++;throw Error();}} as never;await expect(f.port.update(bad,bad)).rejects.toThrow('public_profile_unavailable');await expect(f.port.unpublish(bad)).rejects.toThrow('public_profile_unavailable');expect(getters).toBe(0);expect(f.call).not.toHaveBeenCalled();});
it('applies existing JS Number admission to original numeric groups without SQL rounding',()=>{
 for(const amount of ['0.000001','0.123456','1.0000000000000001','1000000000000000128','1e20','1e21','0.0000001','0.1234567','NaN','Infinity']){
  const value=projectPostgresPublicProfile({...packet(),profile:{...fields(),ledgerBasis:'wallet-wide-recorded-settled-creator-events'},ledger:[{network:'eip155:5042',reader:true,creator:true,sponsored:false,amount,count:'19'}]})!;
  const exact=recordedMicros(Number(amount)),expected=exact===null?null:(BigInt(exact)*BigInt(19)).toString();
  expect(value.ledgers![0]).toEqual({network:'eip155:5042',readerPaidMicros:expected,creatorEarnedMicros:expected,sponsoredCreatorPaymentsMicros:'0'});
  expect(value.ledgers![1].readerPaidMicros).toBe('0');
 }
});
it('poisons only affected opt-in categories and does not infer claimed contribution',()=>{
 const value=projectPostgresPublicProfile({...packet(),profile:{...fields(),ledgerBasis:'wallet-wide-recorded-settled-creator-events'},ledger:[
  {network:'eip155:5042',reader:true,creator:false,sponsored:false,amount:'0.000001',count:'7'},
  {network:'eip155:5042',reader:false,creator:true,sponsored:false,amount:'0.0000001',count:'1'}]})!;
 expect(value.ledgers![0]).toEqual({network:'eip155:5042',readerPaidMicros:'7',creatorEarnedMicros:null,sponsoredCreatorPaymentsMicros:'0'});
 expect(()=>projectPostgresPublicProfile({...packet(),ledger:[{network:'eip155:5042',reader:true,creator:false,sponsored:false,amount:'1',count:'1'}]})).toThrow();
});
it('validates closed current identities and escaped public strings after the final snapshot',()=>{
 const source={id:'synthetic',question:'Question\0\ud800',createdAt:date,citations:[]},row={wireHex:Buffer.from(JSON.stringify(source)).toString('hex'),claimed:true,networks:[]};
 const value=projectPostgresPublicProfile({...packet(),profile:{...fields(),verified:[{provider:'github',externalId:'123',label:'researcher',verifiedAt:date}]},runs:[row]})!;
 expect(value.runs[0]).toMatchObject({question:source.question,ownership:'claimed'});expect(value.verifiedLinks![0].url).toBe('https://github.com/researcher');
 expect(()=>projectPostgresPublicProfile({...packet(),runs:[row,row]})).toThrow();expect(()=>projectPostgresPublicProfile({...packet(),runs:[{...row,wireHex:'ff'}]})).toThrow();
 expect(()=>projectPostgresPublicProfile({...packet(),profile:{...fields(),wallet}})).toThrow();
});
it('captures publication intent before awaiting and retains unknown write outcome without retry',async()=>{
 const f=fixture(),input={published:true,fields:['about'] as const,runIds:['synthetic'],revision:0};let release!:(v:unknown)=>void;f.call.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const request=f.port.update(actor,{...input,fields:[...input.fields]});input.runIds[0]='changed';release({ok:true,value:{}});await expect(request).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);
 expect(JSON.parse(f.call.mock.calls[0][1][1]!)).toMatchObject({runIds:['synthetic']});expect(f.call).toHaveBeenCalledTimes(1);
});
it('discards reads on close and refuses foreign handle packets',async()=>{
 const f=fixture();f.call.mockResolvedValue({ok:true,value:packet()});await expect(f.port.read('other_researcher')).rejects.toThrow('public_profile_unavailable');
 let release!:(v:unknown)=>void;f.call.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const request=f.port.read('researcher');await f.channel.close();release({ok:true,value:packet()});await expect(request).rejects.toThrow('public_profile_unavailable');expect(f.call).toHaveBeenCalledTimes(2);
});
