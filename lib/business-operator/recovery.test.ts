import { expect,it,vi } from "vitest";
import type { A2aOrder } from "../a2a/order";
import type { QueryRun } from "../types";
import { a2aResearchPackage } from "../a2a/research-package";
import { recoverOperatorOriginal } from "./recovery";
const id=`a2a_${"a".repeat(64)}`;
function fixture() {
  let original:A2aOrder={id,queryId:id,authorizationId:"original-nonce",requestHash:"original-hash",
    payer:"0x1111111111111111111111111111111111111111",payee:"0x2222222222222222222222222222222222222222",
    amountUsdc:0.1,creatorBudgetUsdc:0.05,serviceFeeUsdc:0.05,researchMode:"deep",researchPackage:a2aResearchPackage("deep"),
    status:"running",transaction:"original-inbound",request:{question:"original",origin:"a2a"},
    startedAt:"2026-10-06T00:00:00.000Z",workerId:"original-worker",executionJournalVersion:1,
    paymentStartedAt:null,resultSavingAt:"2026-10-06T00:01:00.000Z",response:null,errorCode:null,resolution:null,
    createdAt:"2026-10-06T00:00:00.000Z",updatedAt:"2026-10-06T00:01:00.000Z"};
  const saved:QueryRun={id,question:"original",budget:0.05,subClaims:[],decisions:[],citations:[],evidence:[],claimCoverage:[],
    answer:"saved original",totalSpent:0,totalToCreators:0,trace:[],createdAt:"2026-10-06T00:01:00.000Z",durationMs:60000,
    origin:"a2a",paymentMode:"real",engine:"llm:test-fixture"};
  const db={getA2aOrder:vi.fn(async()=>original),getQueryRun:vi.fn().mockResolvedValue(saved),
    listCreatorPaymentAttemptsByQuery:vi.fn().mockResolvedValue([]),resolveA2aOrder:vi.fn(async(_id,update)=>{original={...original,...update};return true;})};
  return {db,saved,setOrder:(change:Partial<A2aOrder>)=>{original={...original,...change};}};
}
it("repairs a saved original without executing research or payment",async()=>{
  const {db}=fixture();expect(await recoverOperatorOriginal(db,id)).toBe("completed");
  expect(db.getQueryRun).toHaveBeenCalledWith(id);expect(db.resolveA2aOrder).toHaveBeenCalledWith(id,
    expect.objectContaining({status:"completed",resolution:expect.objectContaining({actor:"automatic-poll"})}));
});
it.each(["missing-result","simulated","foreign-result","ledger-mismatch","queued"])("holds %s and never guesses completion",async reason=>{
  const f=fixture();
  if(reason==="missing-result")f.db.getQueryRun.mockResolvedValue(null);
  if(reason==="simulated")f.db.getQueryRun.mockResolvedValue({...f.saved,paymentMode:"offline"});
  if(reason==="foreign-result")f.db.getQueryRun.mockResolvedValue({...f.saved,id:"foreign"});
  if(reason==="ledger-mismatch")f.db.getQueryRun.mockResolvedValue({...f.saved,totalToCreators:0.01});
  if(reason==="queued")f.setOrder({startedAt:null});
  expect(await recoverOperatorOriginal(f.db,id)).toBe("held");expect(f.db.resolveA2aOrder).not.toHaveBeenCalled();
});
