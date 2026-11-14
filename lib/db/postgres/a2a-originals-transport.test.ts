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
it('uses only fixed checkpoint calls and preserves explicit false results',async()=>{
 const c=channel(),native=composePostgresA2aOriginals(c.port,false),id=fixture().order.id;c.call.mockResolvedValue(true);
 expect(await native.markA2aOrderPaymentStarted(id,at)).toBe(true);expect(c.call.mock.calls.at(-1)).toEqual(['a2aPaymentStart',[id,at]]);
 expect(await native.markA2aOrderResultSaving(id,at)).toBe(true);expect(c.call.mock.calls.at(-1)).toEqual(['a2aResultSaving',[id,at]]);
 c.call.mockResolvedValue(false);expect(await native.failA2aOrder(id,'research_failed',at)).toBe(false);expect(c.call.mock.calls.at(-1)).toEqual(['a2aFail',[id,'research_failed',at]]);
});
it('refuses readonly checkpoints and invalid selectors before SQL',async()=>{
 const c=channel(),readonly=composePostgresA2aOriginals(c.port,true),native=composePostgresA2aOriginals(c.port,false),id=fixture().order.id;
 await expect(readonly.markA2aOrderPaymentStarted(id,at)).rejects.toThrow();await expect(readonly.markA2aOrderResultSaving(id,at)).rejects.toThrow();await expect(readonly.failA2aOrder(id,'research_failed',at)).rejects.toThrow();
 for(const invalid of ['',id+'\0','\ud800'])await expect(native.markA2aOrderPaymentStarted(invalid,at)).rejects.toThrow();
 for(const date of ['invalid','2026-02-30T00:00:00.000Z','2026-11-14T07:00:00.000+07:00'])await expect(native.markA2aOrderResultSaving(id,date)).rejects.toThrow();
 for(const code of ['bad\0code','\ud800','x'.repeat(513)])await expect(native.failA2aOrder(id,code,at)).rejects.toThrow();expect(c.call).not.toHaveBeenCalled();
});
it('never retries a checkpoint after an unknown or malformed write response',async()=>{
 const c=channel(),native=composePostgresA2aOriginals(c.port,false),id=fixture().order.id;c.call.mockResolvedValue(null);
 await expect(native.markA2aOrderPaymentStarted(id,at)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(c.call).toHaveBeenCalledOnce();
 c.call.mockClear();c.call.mockRejectedValue(new PostgresDomainWriteOutcomeUnknown());await expect(native.markA2aOrderResultSaving(id,at)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(c.call).toHaveBeenCalledOnce();
});

function retained(){const r=row();for(const field of ['package_data','request_data','response_data','resolution_data'] as const)if(r[field]!==null)(r as Record<string,unknown>)[field]=JSON.stringify(r[field]);return {storeId:'3821e833-f4ca-44d3-a944-0cf892ab0b85',orderWire:JSON.stringify(r)};}
it('captures postpaid JSON before awaits and submits one atomic completion packet',async()=>{
 const c=channel(),native=composePostgresA2aOriginals(c.port,false),snapshot=retained(),response={answer:'paid\0answer\ud800'},id=fixture().order.id;
 c.call.mockImplementation(async(operation)=>operation==='a2aOriginalSnapshot'?snapshot:true);
 const result=native.completeA2aOrder(id,response,at);response.answer='changed after admission';expect(await result).toBe(true);
 expect(c.call.mock.calls.map(call=>call[0])).toEqual(['a2aOriginalSnapshot','a2aComplete']);const packet=JSON.parse(c.call.mock.calls[1][1][1]);
 expect(JSON.parse(packet.responseWire).answer).toBe('paid\0answer\ud800');expect(packet.beforeWire).toBe(snapshot.orderWire);expect(packet.projection.health.cohort).toBe('unknown');expect(JSON.parse(packet.projection.orderWire)).toMatchObject({status:'completed',response_data:packet.responseWire,error_code:null,updated_at:at});
});
it('refuses readonly completion before getters, and invalid selectors/bounds before SQL',async()=>{
 const c=channel(),id=fixture().order.id;let reads=0;const response={get answer(){reads++;return 'private';}};
 await expect(composePostgresA2aOriginals(c.port,true).completeA2aOrder(id,response,at)).rejects.toThrow();expect(reads).toBe(0);
 const native=composePostgresA2aOriginals(c.port,false);await expect(native.completeA2aOrder(id,response,'invalid')).rejects.toThrow();expect(reads).toBe(0);
 await expect(native.completeA2aOrder(id,{answer:'x'.repeat(4000001)},at)).rejects.toThrow();expect(c.call).not.toHaveBeenCalled();
});
it('preserves raw order JSON on reads and does not overwrite a finished or stale original',async()=>{
 const c=channel(),id=fixture().order.id,native=composePostgresA2aOriginals(c.port,false),snapshot=retained(),r=JSON.parse(snapshot.orderWire);r.response_data=JSON.stringify({answer:'retained\0\ud800'});r.status='completed';
 c.call.mockResolvedValue({...snapshot,orderWire:JSON.stringify(r)});expect((await native.getA2aOrder(id))?.response?.answer).toBe('retained\0\ud800');expect(await native.completeA2aOrder(id,{answer:'replacement'},at)).toBe(false);expect(c.call.mock.calls.every(call=>call[0]==='a2aOriginalSnapshot')).toBe(true);
 c.call.mockImplementation(async(operation)=>operation==='a2aOriginalSnapshot'?snapshot:false);expect(await native.completeA2aOrder(id,{answer:'stale'},at)).toBe(false);
});
it('reports an unknown completion after malformed ACK or disposal without retrying',async()=>{
 const c=channel(),id=fixture().order.id,native=composePostgresA2aOriginals(c.port,false);c.call.mockImplementation(async(operation)=>operation==='a2aOriginalSnapshot'?retained():{});
 await expect(native.completeA2aOrder(id,{answer:'saved'},at)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(c.call.mock.calls.filter(call=>call[0]==='a2aComplete')).toHaveLength(1);
 c.call.mockClear();c.call.mockImplementation(async(operation)=>{if(operation==='a2aOriginalSnapshot')return retained();c.state.closed=true;return true;});await expect(native.completeA2aOrder(id,{answer:'saved'},at)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(c.call.mock.calls.filter(call=>call[0]==='a2aComplete')).toHaveLength(1);
});

it('refuses readonly recovery before inspecting the update',async()=>{const c=channel();let reads=0;await expect(composePostgresA2aOriginals(c.port,true).resolveA2aOrder(fixture().order.id,{get status(){reads++;return 'completed';}} as never)).rejects.toThrow();expect(reads).toBe(0);expect(c.call).not.toHaveBeenCalled();});
