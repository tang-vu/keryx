import { z } from 'zod';
import type { A2aOrderResolutionUpdate } from '../../a2a/order';
const time=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v);
const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),digest=z.string().regex(/^[a-f0-9]{64}$/);
const evidence=z.object({executionJournalVersion:z.literal(1).nullable(),paymentBoundaryCrossed:z.boolean(),resultSaveBoundaryCrossed:z.boolean(),creatorAttempts:count,settledCreatorMicros:count,pendingCreatorMicros:count,failedCreatorMicros:count,simulatedCreatorMicros:count,queryRunFound:z.boolean()}).strict();
const resolution=z.object({action:z.enum(['repair_completed','close_failed','fulfill_failed_original']),actor:z.enum(['automatic-poll','operator-cli']),reason:z.enum(['saved_real_query_run','verified_failed_original_fulfilled','no_saved_run_before_execution_boundaries']),evidence,resolvedAt:time,fulfillment:z.object({claimId:digest,originalFailureSha256:digest,authoritySha256:digest,providerLedgerSha256:digest,runSha256:digest}).strict().optional()}).strict();
const update=z.discriminatedUnion('status',[z.object({status:z.literal('completed'),response:z.record(z.string(),z.unknown()),resolution}).strict(),z.object({status:z.literal('failed'),errorCode:z.literal('operator_reviewed_no_result'),startedBefore:time,resolution}).strict()]);
/** Capture only the current typed recovery protocol. Preserve the caller's raw
 * resolution property order; parsed observations never grant payment authority. */
export function captureA2aRecovery(raw:A2aOrderResolutionUpdate){
 const wire=JSON.stringify(raw);if(typeof wire!=='string'||Buffer.byteLength(wire)>8388608)throw Error('Native recovery input bound');
 const captured=JSON.parse(wire) as A2aOrderResolutionUpdate,input=update.parse(captured),e=input.resolution.evidence;
 if(input.status==='completed'?(input.resolution.action!=='repair_completed'||!e.queryRunFound||e.simulatedCreatorMicros>0):(input.resolution.action!=='close_failed'||e.queryRunFound||e.executionJournalVersion!==1||e.paymentBoundaryCrossed||e.resultSaveBoundaryCrossed||e.creatorAttempts>0))return null;
 const resolutionWire=JSON.stringify(captured.resolution),responseWire=input.status==='completed'?JSON.stringify(captured.status==='completed'?captured.response:null):null;
 if(Buffer.byteLength(resolutionWire)>32768||responseWire!==null&&Buffer.byteLength(responseWire)>4000000)throw Error('Native recovery original bound');
 return {input,resolutionWire,responseWire};
}
