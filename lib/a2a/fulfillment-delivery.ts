import { canonicalJson } from '../canonical-json';
import type { QueryRun } from '../types';
import type { A2aOrder,A2aOrderResolution } from './order';
import { a2aResponseFromRun,quoteFromA2aOrder } from './result';
import { fulfillmentObjectSha256,type A2aFulfillmentClaim,type FulfillmentCompletionInput } from './fulfillment-authority';
import { historicalNativeEvidenceCsv } from '../db/a2a-historical-evidence-csv';

export function fulfillmentResolution(claim:A2aFulfillmentClaim,completion:FulfillmentCompletionInput):A2aOrderResolution{
 return {action:'fulfill_failed_original',actor:'operator-cli',reason:'verified_failed_original_fulfilled',resolvedAt:completion.completedAt,
  evidence:{executionJournalVersion:1,paymentBoundaryCrossed:false,resultSaveBoundaryCrossed:true,creatorAttempts:0,settledCreatorMicros:0,pendingCreatorMicros:0,failedCreatorMicros:0,simulatedCreatorMicros:0,queryRunFound:true},
  fulfillment:{claimId:claim.claimId,originalFailureSha256:claim.authority.originalEvidenceSha256,authoritySha256:fulfillmentObjectSha256(claim.authority),providerLedgerSha256:completion.providerLedgerSha256,runSha256:completion.runSha256}};
}
function preCsl(run:QueryRun,response:ReturnType<typeof a2aResponseFromRun>){
 if(run.originalFulfillment?.format!=='keryx-a2a-original-fulfillment-result-v1'&&run.originalFulfillment?.format!=='keryx-a2a-original-fulfillment-result-v2')return null;
 const {bibtex,ris,evidenceCsv}=response.researchExports;
 return {...response,researchExports:{bibtex,ris,evidenceCsv},...(response.bibliography?{bibliographyExports:response.bibliography.bibliographyExports}:{})};
}
function preCheckpoint<T extends {readCheckpoints:unknown}>(run:QueryRun,response:T){
 if(run.originalFulfillment?.format!=='keryx-a2a-original-fulfillment-result-v1'&&run.originalFulfillment?.format!=='keryx-a2a-original-fulfillment-result-v2')return null;
 const {readCheckpoints,...historical}=response;
 return canonicalJson(readCheckpoints)===canonicalJson({status:'unavailable'})?historical:null;
}
/** Exact expected-side historical variants only. Callers must first validate the
 * genuine run/claim and evidence capability; no stored receipt is normalized. */
export function fulfilledOriginalOrders(run:QueryRun,claim:A2aFulfillmentClaim,completion:FulfillmentCompletionInput):A2aOrder[]{
 const expected={...claim.failedOrder,status:'completed' as const,errorCode:null,resultSavingAt:completion.completedAt,updatedAt:completion.completedAt,
  resolution:fulfillmentResolution(claim,completion),response:a2aResponseFromRun(run,quoteFromA2aOrder(claim.failedOrder),{acceptedAt:claim.failedOrder.createdAt,startedAt:claim.failedOrder.startedAt})};
 const historical=run.originalFulfillment?.format==='keryx-a2a-original-fulfillment-result-v1'||run.originalFulfillment?.format==='keryx-a2a-original-fulfillment-result-v2';
 const preReadScope=historical?{...expected.response,researchExports:{...expected.response.researchExports,evidenceCsv:historicalNativeEvidenceCsv(run)}}:null;
 const result:A2aOrder[]=[];
 for(const response of preReadScope===null?[expected.response]:[expected.response,preReadScope]){
  result.push({...expected,response});const legacy=preCsl(run,response);if(legacy!==null)result.push({...expected,response:legacy});
  const checkpoint=preCheckpoint(run,response);if(checkpoint!==null)result.push({...expected,response:checkpoint});
  const checkpointCsl=legacy===null?null:preCheckpoint(run,legacy);if(checkpointCsl!==null)result.push({...expected,response:checkpointCsl});
 }
 return result;
}
