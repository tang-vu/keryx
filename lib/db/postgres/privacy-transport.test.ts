import { describe,it,expect,vi } from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {installSqliteApplicationSchema} from '../sqlite-application-schema';
import {writeSqliteQueryRun} from '../query-run-record';
import {RUN_PRIVACY_SQL,createSqliteRunPrivacy} from '../run-privacy-sqlite';
import { composePostgresPrivacy } from './privacy-transport';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const wallet='0x'+'a1'.repeat(20),binding={network:'eip155:5042' as const,origin:'https://keryx.cc'},actor={wallet,binding,sessionHash:'11'.repeat(32)},id='synthetic-private-run',requestId='12345678-1234-4234-8234-123456789abc';
const run={id,createdAt:'2026-01-01T00:00:00.000Z',question:'Question',answer:'Original\0answer',engine:'heuristic',budget:0,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[]};
const item=()=>({id,originalHex:Buffer.from(JSON.stringify(run)).toString('hex'),state:{visibility:'private',revision:0,erased:false}});
function fixture(readOnly=false){let closed=false;const call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={get closed(){return closed;},call,async close(){closed=true;}};return {call,channel,privacy:composePostgresPrivacy(channel,binding.network,readOnly,true)};}
describe('native privacy protocol boundary',()=>{
 it('restores exact scalar engine metadata and keeps the financial body empty',async()=>{
  const f=fixture(),financial={...run,engineHex:Buffer.from('engine\0\ufffd').toString('hex'),question:'',answer:''};delete (financial as Partial<typeof run>).engine;
  f.call.mockResolvedValue({item:financial});expect(await f.privacy.settlement(id)).toEqual({...run,engine:'engine\0\ufffd',question:'',answer:''});
  f.call.mockResolvedValue({item:{...financial,answer:'PRIVATE_BODY'}});await expect(f.privacy.settlement(id)).rejects.toThrow('privacy_unavailable');
  f.call.mockResolvedValue({item:{...financial,engine:'old shadow'}});await expect(f.privacy.settlement(id)).rejects.toThrow('privacy_unavailable');
 });
 it.each(['\ufeff','\ufeffengine\0\ud800','\ufeff\ufeffengine'])('matches actual Source settlement with leading BOM engine %j',async engine=>{
  const db=new DatabaseSync(':memory:');try{
   installSqliteApplicationSchema(db);db.exec(RUN_PRIVACY_SQL);writeSqliteQueryRun(db,{...run,engine},false);
   const source=await createSqliteRunPrivacy(db).settlement(id);expect(source).not.toBeNull();const {engine:bound,...metadata}=source!;
   const f=fixture();f.call.mockResolvedValue({item:{...metadata,engineHex:Buffer.from(bound).toString('hex')}});
   expect(await f.privacy.settlement(id)).toEqual(source);expect(bound.startsWith('\ufeff')).toBe(true);expect(db.prepare('SELECT data FROM query_runs WHERE id=?').get(id)!.data).toBe(JSON.stringify({...run,engine}));
  }finally{db.close();}
 });
 it('keeps strict UTF8/HEX/byte bounds and does not erase a BOM before raw JSON',async()=>{
  const f=fixture(),{engine:_,...metadata}={...run,question:'',answer:''};void _;
  for(const engineHex of ['ff','efbbbfedb080','0','zz','61'.repeat(16385)]){f.call.mockResolvedValue({item:{...metadata,engineHex}});await expect(f.privacy.settlement(id)).rejects.toThrow('privacy_unavailable');}
  f.call.mockResolvedValue({exists:true,item:{...item(),originalHex:Buffer.from('\ufeff'+JSON.stringify(run)).toString('hex')}});await expect(f.privacy.read(id,actor)).rejects.toThrow('privacy_unavailable');
 });
 it('refuses readonly effects before parsing or native I/O',async()=>{const f=fixture(true);await expect(f.privacy.creationReady()).rejects.toThrow('privacy_unavailable');await expect(f.privacy.erase(id,actor,{revision:0,requestId})).rejects.toThrow('privacy_unavailable');await expect(f.privacy.export(id,actor,requestId)).rejects.toThrow('privacy_unavailable');expect(f.call).not.toHaveBeenCalled();});
 it('retains unchanged private originals and refuses malformed or hidden responses',async()=>{const f=fixture();f.call.mockResolvedValue({exists:true,item:item()});expect((await f.privacy.read(id,actor)).item?.run).toEqual(run);await expect(f.privacy.read(id)).rejects.toThrow('privacy_unavailable');f.call.mockResolvedValue({exists:false,item:item()});await expect(f.privacy.read(id,actor)).rejects.toThrow('privacy_unavailable');f.call.mockResolvedValue({exists:true,item:{...item(),originalHex:'ff'}});await expect(f.privacy.read(id,actor)).rejects.toThrow('privacy_unavailable');});
 it('captures actor and input bytes before await and checks mutation outcomes',async()=>{const f=fixture(),who={...actor,binding:{...binding}},input={visibility:'unlisted' as const,revision:0,requestId};f.call.mockResolvedValue({state:{visibility:'unlisted',revision:1,erased:false}});const pending=f.privacy.change(id,who,input);who.binding.origin='https://changed.example';input.revision=8;expect(await pending).toEqual({visibility:'unlisted',revision:1,erased:false});const args=f.call.mock.calls[0][1];expect(JSON.parse(args[1]!)).toEqual(actor);expect(JSON.parse(args[2]!)).toEqual({visibility:'unlisted',revision:0,requestId});f.call.mockResolvedValue({state:{visibility:'public',revision:1,erased:false}});await expect(f.privacy.change(id,actor,{visibility:'private',revision:0,requestId})).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);});
 it('returns only exact known rollback failures and preserves uncertain writes',async()=>{const f=fixture();f.call.mockResolvedValue({error:'retention_hold'});await expect(f.privacy.erase(id,actor,{revision:0,requestId})).rejects.toThrow('retention_hold');f.call.mockRejectedValue(new PostgresDomainWriteOutcomeUnknown());await expect(f.privacy.erase(id,actor,{revision:0,requestId})).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(f.call).toHaveBeenCalledTimes(2);});
 it('never publishes read or write results after terminal disposal',async()=>{const f=fixture();let finish!:(value:unknown)=>void;f.call.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const pending=f.privacy.setDefault(actor,'private',requestId),check=expect(pending).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);await f.channel.close();finish({visibility:'private'});await check;await expect(f.privacy.read(id,actor)).rejects.toThrow('privacy_unavailable');expect(f.call).toHaveBeenCalledTimes(1);});
});
