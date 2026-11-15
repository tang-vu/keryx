import {describe,it,expect,vi} from 'vitest';
import {composePostgresSourceObservations} from './source-observation-transport';
import {PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel} from './domain-channel';
import {SOURCE_OBSERVATION_CALLS} from './source-observation-calls';
const wallet='0x'+'ab'.repeat(20),input=()=>({sourceId:'source',walletAddress:wallet,feedUrl:'feed'}),hex=(value:string)=>Buffer.from(value).toString('hex');
function fixture(readOnly=false){let closed=false;const call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={get closed(){return closed;},call,async close(){closed=true;}};return {call,channel,port:composePostgresSourceObservations(channel,readOnly)};}
describe('closed native Source observations',()=>{
 it('uses independent fixed read/write calls and keeps ordinary descriptor caps unchanged',()=>{
  expect(SOURCE_OBSERVATION_CALLS.sourceEvidenceProvenanceRead).toMatchObject({args:1,write:false,transaction:true,inputBytes:1544192,bytes:2359296});expect(SOURCE_OBSERVATION_CALLS.sourceVerifyIfUnchanged).toMatchObject({args:1,write:true,inputBytes:26624,bytes:128});
  expect(SOURCE_OBSERVATION_CALLS.sourceEvidenceProvenanceRead.sql).toContain("'source-evidence-provenance'");expect(SOURCE_OBSERVATION_CALLS.sourceVerifyIfUnchanged.sql).toContain('NULL,$3::text');
 });
 it('empty requests never invoke any hosted function',async()=>{const f=fixture(true);expect(await f.port.readEvidenceProvenanceBatch({sourceIds:[],itemIds:[]})).toEqual([]);expect(f.call).not.toHaveBeenCalled();});
 it('captures all ID bytes before awaiting and returns only exact requested flags',async()=>{
  const f=fixture(true),lookup={sourceIds:['source\0\ud800'],itemIds:['item']};let finish!:(value:unknown)=>void;f.call.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const pending=f.port.readEvidenceProvenanceBatch(lookup);lookup.sourceIds[0]='changed';
  expect(JSON.parse(f.call.mock.calls[0][1][0]!)).toEqual({sourceIdsHex:[hex('source\0\ufffd')],itemIdsHex:[hex('item')]});finish({format:'keryx-native-source-evidence-v1',sourceIdsHex:[hex('source\0\ufffd')],items:[{idHex:hex('item'),sourceIdHex:hex('source')}]});expect(await pending).toEqual(['source:source\0\ufffd','item:source:item']);
 });
 it('readonly verification refuses before parsing fields or submitting SQL',async()=>{const f=fixture(true),touched=vi.fn(),raw={get sourceId(){touched();return 'source';}};await expect(f.port.verifySourceIfUnchanged(raw as ReturnType<typeof input>)).rejects.toThrow();expect(touched).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();});
 it('captures exact verification predicates before await and returns matched-row booleans',async()=>{
  const f=fixture(),value=input();f.call.mockResolvedValueOnce(true);const pending=f.port.verifySourceIfUnchanged(value);value.feedUrl='mutated';expect(await pending).toBe(true);expect(JSON.parse(f.call.mock.calls[0][1][0]!)).toEqual({operation:'verify-if-unchanged',sourceIdHex:hex('source'),walletHex:hex(wallet),feedUrlHex:hex('feed')});f.call.mockResolvedValueOnce(false);expect(await f.port.verifySourceIfUnchanged(input())).toBe(false);
 });
 it('preserves a lost write ACK as unknown and never retries it',async()=>{const f=fixture(),unknown=new PostgresDomainWriteOutcomeUnknown();f.call.mockRejectedValueOnce(unknown);await expect(f.port.verifySourceIfUnchanged(input())).rejects.toBe(unknown);expect(f.call).toHaveBeenCalledTimes(1);});
 it('malformed or disposed write ACKs remain unknown',async()=>{const f=fixture();f.call.mockResolvedValueOnce({verified:true});await expect(f.port.verifySourceIfUnchanged(input())).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);let finish!:(value:unknown)=>void;f.call.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const pending=f.port.verifySourceIfUnchanged(input());await f.channel.close();finish(true);await expect(pending).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);});
 it('refuses malformed provenance packets and results after disposal',async()=>{const f=fixture();f.call.mockResolvedValueOnce({format:'keryx-native-source-evidence-v1',sourceIdsHex:[hex('not-requested')],items:[]});await expect(f.port.readEvidenceProvenanceBatch({sourceIds:['source'],itemIds:[]})).rejects.toThrow();let finish!:(value:unknown)=>void;f.call.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const pending=f.port.readEvidenceProvenanceBatch({sourceIds:['source'],itemIds:[]});await f.channel.close();finish({format:'keryx-native-source-evidence-v1',sourceIdsHex:[],items:[]});await expect(pending).rejects.toThrow();await expect(f.port.readEvidenceProvenanceBatch({sourceIds:[],itemIds:[]})).rejects.toThrow();});
});
