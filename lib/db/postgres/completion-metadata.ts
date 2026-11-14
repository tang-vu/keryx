import { recordedCompletionCohort,type CompletionMarkers } from '../../a2a/completion-latency';
/** Small recorded observations only. Cohorts never grant payment/delivery
 * authority. Raw postpaid JSON is retained independently, without JSONB casts. */
export function completionMetadata(row:Readonly<Record<string,unknown>>,sourceMarkers?:Pick<CompletionMarkers,'researchPackage'|'serviceReceipt'|'resolution'>){
 const parse=(value:unknown,fallback:unknown)=>{try{return typeof value==='string'?JSON.parse(value):value??fallback;}catch{return fallback;}};
 const response=parse(row.response_data,null),object=response!==null&&typeof response==='object'&&!Array.isArray(response)?response as Record<string,unknown>:null;
 const receipt=object?.serviceReceipt,serviceReceipt=receipt!==null&&typeof receipt==='object'&&!Array.isArray(receipt)?receipt:undefined;
 const markers={createdAt:String(row.created_at),updatedAt:String(row.updated_at),startedAt:row.started_at==null?null:String(row.started_at),executionJournalVersion:row.execution_journal_version,
  researchPackage:parse(row.package_data,undefined),serviceReceipt,resolution:parse(row.resolution_data,row.resolution_data==null?null:{}),...sourceMarkers};
 const bytes=(value:unknown)=>value==null?0:Buffer.byteLength(JSON.stringify(value));
 return Object.freeze({cohort:recordedCompletionCohort(markers),serviceReceiptBytes:bytes(markers.serviceReceipt),resolutionBytes:bytes(markers.resolution)});
}
