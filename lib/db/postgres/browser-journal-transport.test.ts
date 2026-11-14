import { expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ARC_MAINNET_PROFILE as profile } from '../../arc-network-profile';
import type { BrowserJournalAdmission } from '../browser-authorization-journal';
import type { PostgresDomainChannel } from './domain-channel';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
import { browserJournalSha256,captureBrowserJournalSelector,type BrowserSourceSnapshot } from './browser-journal-packet';
import { composePostgresBrowserJournal } from './browser-journal-transport';

// These channel doubles test capture, routing and failure handling only. They
// are never an installed native adapter or evidence of PostgreSQL acceptance.
vi.mock('./source-claim-purchase-policy',()=>({sourceClaimPolicyRuntime:()=>({fixture:true}),sourceClaimPolicySelector:(v:unknown)=>JSON.stringify(v),captureHostedSourceClaimPolicy:()=>({fixture:true})}));
function input():BrowserJournalAdmission {const queryId=randomUUID(),signer='0x'+'31'.repeat(20),payee='0x'+'32'.repeat(20),grantEpoch=randomUUID();return {sessionId:'session',requestId:'request',queryId,grantEpoch,signer,network:profile.networkId,token:profile.usdcAddress,gatewayContract:profile.gatewayWallet,sourceId:'source',offerId:null,kind:'fetch',payee,amountMicroUsdc:15000,requirements:{scheme:'exact',network:profile.networkId,asset:profile.usdcAddress,payTo:payee,amount:'15000',maxTimeoutSeconds:604900,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:profile.gatewayWallet}},payment:{queryId,sourceId:'source',sourceName:'raw\ud800',payer:signer,payee,kind:'fetch',amountUsdc:.015,network:profile.networkId,grantEpoch,rationale:'wire\0\udfff'}};}
function channel(call:(operation:string,args:readonly(string|null)[])=>Promise<unknown>,closed=false):PostgresDomainChannel{return {closed,close:async()=>{},call:call as PostgresDomainChannel['call']};}
function emptySnapshot():BrowserSourceSnapshot{return {selector:captureBrowserJournalSelector('session','request'),intent:null,binding:null,paymentWire:null,original:null,query:null,namespace:null,grant:null,signerSpent:null,epochSpent:null,controls:{journalActive:false,signingActive:false,floor:2,ever:0}};}
function envelope(snapshot=emptySnapshot()){const wire=JSON.stringify(snapshot);return {wire,sha256:browserJournalSha256(wire)};}

it('refuses readonly or closed writes before evaluating input getters',async()=>{
 let touched=0;const raw=Object.defineProperty({},'sessionId',{enumerable:true,get(){touched++;throw Error('getter');}}) as BrowserJournalAdmission;
 for(const [readonly,closed] of [[true,false],[false,true]] as const){const call=vi.fn(async()=>true),port=composePostgresBrowserJournal(channel(call,closed),readonly);await expect(port.admitBrowserJournal(raw)).rejects.toThrow();expect(call).not.toHaveBeenCalled();}expect(touched).toBe(0);
});
it('captures one nonce, detached raw metadata and scalar Source projection before policy awaits',async()=>{
 let release!:(value:boolean)=>void;const gate=new Promise<boolean>(resolve=>{release=resolve;}),calls:{op:string;args:readonly(string|null)[]}[]=[];
 const port=composePostgresBrowserJournal(channel(async(op,args)=>{calls.push({op,args});if(op==='browserJournalControl')return gate;if(op==='hostedSourcePolicySnapshot')return {};if(op==='browserJournalAction')return 'admitted';throw Error('unexpected');}),false),raw=input(),pending=port.admitBrowserJournal(raw);
 raw.payment.rationale='changed';raw.requirements.amount='1';release(true);const result=await pending;expect(result.status).toBe('admitted');const call=calls.find(c=>c.op==='browserJournalAction')!,packet=JSON.parse(call.args[1]!);
 expect(calls.map(c=>c.op)).toEqual(['browserJournalControl','hostedSourcePolicySnapshot','browserJournalAction']);expect(packet.intent.nonce).toMatch(/^0x[0-9a-f]{64}$/);expect(JSON.parse(packet.paymentMetadataWire).rationale).toBe('wire\0\udfff');expect(JSON.parse(packet.payment.rowWire).rationale).toBe('wire\0\ufffd');expect(packet.payment.projection.rationale).toBeNull();expect(JSON.parse(packet.requirementsWire).amount).toBe('15000');if(result.status==='admitted')expect(result.journal.nonce).toBe(packet.intent.nonce);
});
it('returns Source inactive before context-policy checks or writes',async()=>{
 const call=vi.fn(async()=>false),port=composePostgresBrowserJournal(channel(call),false),raw=input();raw.payment.sourceClaim={different:true} as never;expect(await port.admitBrowserJournal(raw)).toEqual({status:'inactive'});expect(call).toHaveBeenCalledTimes(1);
});
it('does not retry an unknown acknowledgement or reinterpret malformed write output',async()=>{
 const call=vi.fn(async()=>{throw new PostgresDomainWriteOutcomeUnknown();}),port=composePostgresBrowserJournal(channel(call),false);await expect(port.cancelPreparedBrowserJournal('session','request')).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(call).toHaveBeenCalledTimes(1);
 const malformed=vi.fn(async()=>({success:true}));await expect(composePostgresBrowserJournal(channel(malformed),false).exposeBrowserJournal('session','request')).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(malformed).toHaveBeenCalledTimes(1);
});
it('keeps caller signed metadata as raw JSON until Source phase and replay checks',async()=>{
 const calls:(readonly(string|null)[])[]=[];let release!:(value:boolean)=>void;const wait=new Promise<boolean>(r=>{release=r;}),port=composePostgresBrowserJournal(channel(async(_op,args)=>{calls.push(args);return wait;}),false),metadata={validAfter:'',validBefore:'0x10',headerHash:'raw\ud800'},pending=port.signBrowserJournal('session','request',metadata);metadata.headerHash='mutated';release(true);expect(await pending).toBe(true);const packet=JSON.parse(calls[0][1]!);expect(JSON.parse(packet.metadataWire)).toEqual({validAfter:'',validBefore:'0x10',headerHash:'raw\ud800'});expect(packet.canonical).toBe(false);expect(packet.originalSha256).toBeNull();expect(packet).not.toHaveProperty('metadata');
});
it('validates raw snapshots and finishes even a null signing observation after its await boundary',async()=>{
 const calls:string[]=[],snapshot=envelope(),port=composePostgresBrowserJournal(channel(async(op,args)=>{calls.push(op);if(op==='browserJournalFinish')expect(JSON.parse(args[0]!).snapshotSha256).toBe(snapshot.sha256);return snapshot;}),true);expect(await port.readBrowserSigningSnapshot('0x'+'31'.repeat(20),'session','request')).toBeNull();expect(calls).toEqual(['browserJournalState','browserJournalFinish']);
 const bad=composePostgresBrowserJournal(channel(async()=>({...snapshot,sha256:'00'.repeat(32)})),true);await expect(bad.getBrowserJournal('session','request')).rejects.toThrow('snapshot unavailable');
 const changed=composePostgresBrowserJournal(channel(async op=>{if(op==='browserJournalFinish')throw Error('scope changed');return snapshot;}),true);await expect(changed.readBrowserSigningSnapshot('owner','session','request')).rejects.toThrow('scope changed');
});
it('preserves the historical preparer refusal before a durable-v2 native call',async()=>{
 const call=vi.fn(async()=>true),raw=input();await expect(composePostgresBrowserJournal(channel(call),false).admitBrowserSigningOriginal({journal:raw,queryId:raw.queryId,queryNamespace:'0x'+'33'.repeat(32)})).rejects.toThrow('Invalid browser authorization intent');expect(call).not.toHaveBeenCalled();
});
