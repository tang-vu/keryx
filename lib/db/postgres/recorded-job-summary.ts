import { summarizeA2aOperations,type A2aOperationsRow,type A2aOperationsSnapshot } from '../../a2a/operations';
import { completionLatencyCohorts,type CompletionLatencyCohort } from '../../a2a/completion-latency';
export interface NativeRecordedJobRow extends Pick<A2aOperationsRow,'status'|'createdAt'|'updatedAt'|'startedAt'> {completionCohort:CompletionLatencyCohort;}
/** Consume recorded labels directly; never synthesize a receipt/recovery proof.
 * Labels have no payment authority. Base counters retain the Source calculator. */
export function summarizeNativeRecordedJobs(rows:NativeRecordedJobRow[],now:number):A2aOperationsSnapshot{
 const result=summarizeA2aOperations(rows,now,false),cohorts=completionLatencyCohorts(),samples:Record<CompletionLatencyCohort,number[]>={ordinary:[],recovered:[],unknown:[]};
 for(const row of rows){
  const updated=Date.parse(row.updatedAt);if(row.status!=='completed'||!Number.isFinite(updated)||updated<now-86400000||updated>now)continue;
  cohorts[row.completionCohort].completed++;const created=Date.parse(row.createdAt);
  if(Number.isFinite(created)&&updated>=created)samples[row.completionCohort].push(updated-created);
 }
 for(const cohort of ['ordinary','recovered','unknown'] as const){
  const values=samples[cohort].sort((a,b)=>a-b);cohorts[cohort].timedSamples=values.length;
  const percentile=(fraction:number)=>values.length?values[Math.max(0,Math.ceil(values.length*fraction)-1)]??null:null;
  cohorts[cohort].p50Ms=percentile(0.5);cohorts[cohort].p95Ms=percentile(0.95);
 }
 return {...result,completionLatencyCohorts:cohorts};
}
