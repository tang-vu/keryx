import { expect,it,vi } from 'vitest';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { syntheticA2aOriginal } from '../a2a-original-fixture';
import { composePostgresA2aOriginals } from './a2a-originals-transport';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const at='2026-11-14T00:00:00.000Z',fixture=()=>syntheticA2aOriginal(970,ARC_MAINNET_PROFILE);
function channel(){const state={closed:false},call=vi.fn();return {state,call,port:{call,get closed(){return state.closed;},close:async()=>{state.closed=true;}} as PostgresDomainChannel};}
function row(){const {order:o}=fixture();return {id:o.id,query_id:o.queryId,authorization_id:o.authorizationId,request_hash:o.requestHash,payer:o.payer,payee:o.payee,amount_usdc:o.amountUsdc,creator_budget_usdc:o.creatorBudgetUsdc,service_fee_usdc:o.serviceFeeUsdc,research_mode:o.researchMode,package_data:o.researchPackage,status:o.status,transaction_id:o.transaction,request_data:o.request,started_at:null,worker_id:null,execution_journal_version:1,payment_started_at:null,result_saving_at:null,response_data:null,error_code:null,resolution_data:null,created_at:o.createdAt,updated_at:o.updatedAt};}
it('captures exact binding and only invokes the fixed operation before awaits',async()=>{
 const c=channel(),expected=fixture().binding,original=expected.requestHash;c.call.mockResolvedValue(true);const result=composePostgresA2aOriginals(c.port,false).hasA2aOriginalSettlement(expected);expected.requestHash='aa'.repeat(32);expect(await result).toBe(true);expect(c.call).toHaveBeenCalledOnce();expect(c.call.mock.calls[0][0]).toBe('a2aOriginalSettled');expect(JSON.parse(c.call.mock.calls[0][1][0]).requestHash).toBe(original);
});
it('never interprets a failed or malformed proof read as absence',async()=>{
 const c=channel(),native=composePostgresA2aOriginals(c.port,false);c.call.mockResolvedValue(false);expect(await native.hasA2aOriginalSettlement(fixture().binding)).toBe(false);
 for(const value of [null,{},'false']){c.call.mockResolvedValue(value);await expect(native.hasA2aOriginalSettlement(fixture().binding)).rejects.toThrow();}
 c.call.mockRejectedValue(new Error('transport refused'));await expect(native.hasA2aOriginalSettlement(fixture().binding)).rejects.toThrow();
});
it('refuses readonly mutation before inspecting binding getters or submitting SQL',async()=>{
 const c=channel();let reads=0;await expect(composePostgresA2aOriginals(c.port,true).claimA2aOriginal({get id(){reads++;return fixture().binding.id;}} as never,'worker',at)).rejects.toThrow();expect(reads).toBe(0);expect(c.call).not.toHaveBeenCalled();
});
it('rejects foreign identities, invalid worker text and queue bounds before submission',async()=>{
 const c=channel(),native=composePostgresA2aOriginals(c.port,false);await expect(native.hasA2aOriginalSettlement(syntheticA2aOriginal(970).binding)).rejects.toThrow();
 for(const worker of ['','\0','\ud800','x'.repeat(201)])await expect(native.claimA2aOriginal(fixture().binding,worker,at)).rejects.toThrow();
 for(const take of [0,501,1.5,NaN])await expect(native.listUnfinishedA2aOrders(take)).rejects.toThrow();expect(c.call).not.toHaveBeenCalled();
});
it('retains unreadable queue positions, truncation and legacy false JSON cells',async()=>{
 const c=channel(),native=composePostgresA2aOriginals(c.port,false),valid={...row(),request_data:false,package_data:false,response_data:false};c.call.mockResolvedValue({rows:[{...row(),id:'bad-id'},valid,row()]});
 const result=await native.listUnfinishedA2aOrders(2);expect(result).toMatchObject({unreadable:1,truncated:true,orders:[{request:false,researchPackage:false,response:false}]});expect(c.call.mock.calls[0]).toEqual(['a2aOriginalUnfinished',['2']]);
 c.call.mockResolvedValue({rows:[row(),row(),row(),row()]});await expect(native.listUnfinishedA2aOrders(2)).rejects.toThrow();
});
it('reports unknown write outcomes after malformed/changed replies or disposal without retry',async()=>{
 const c=channel(),native=composePostgresA2aOriginals(c.port,false);c.call.mockResolvedValue({});await expect(native.claimA2aOriginal(fixture().binding,'worker',at)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(c.call).toHaveBeenCalledOnce();
 c.call.mockClear();c.call.mockImplementation(async()=>{c.state.closed=true;return {...row(),started_at:at,worker_id:'worker',updated_at:at};});await expect(native.claimA2aOriginal(fixture().binding,'worker',at)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(c.call).toHaveBeenCalledOnce();
});
