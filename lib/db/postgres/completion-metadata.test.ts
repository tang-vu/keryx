import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { recordedCompletionCohort } from '../../a2a/completion-latency';
import { summarizeA2aOperations,type A2aOperationsRow } from '../../a2a/operations';
import { completionMetadata } from './completion-metadata';
import { summarizeNativeRecordedJobs } from './recorded-job-summary';
import { acceptanceOriginalMetadata } from './acceptance-metadata';
const created='2026-11-14T00:00:00.000Z',started='2026-11-14T00:00:01.000Z',finished='2026-11-14T00:00:02.000Z',updated='2026-11-14T00:00:03.000Z';
const pkg={schema:'urn:keryx:a2a-research-package:1',version:'1.0.0',id:'keryx-quick'},receipt={packageId:pkg.id,packageVersion:pkg.version,outcome:'completed',objectiveKind:'provisional_slo',remedy:'none',acceptedAt:created,startedAt:started,finishedAt:finished};
const row=()=>({id:'legacy-recorded-health',created_at:created,updated_at:updated,started_at:started,execution_journal_version:1,package_data:JSON.stringify(pkg),response_data:JSON.stringify({answer:'paid\0answer\ud800',serviceReceipt:receipt}),resolution_data:null});
it('classifies raw postpaid JSON without disclosing or normalizing its answer',()=>{const source=row(),wire=JSON.stringify(source),meta=completionMetadata(source);expect(meta).toEqual({cohort:'ordinary',serviceReceiptBytes:Buffer.byteLength(JSON.stringify(receipt)),resolutionBytes:0});expect(JSON.stringify(source)).toBe(wire);expect(JSON.stringify(meta)).not.toMatch(/paid|answer|\\u0000|\\ud800/);});
it('keeps malformed recovery markers unknown and permits Source first-key marker overrides',()=>{expect(completionMetadata({...row(),resolution_data:'invalid JSON'}).cohort).toBe('unknown');const source={...row(),response_data:'{"serviceReceipt":'+JSON.stringify(receipt)+',"serviceReceipt":{}}'};expect(completionMetadata(source).cohort).toBe('unknown');expect(completionMetadata(source,{researchPackage:pkg,serviceReceipt:receipt,resolution:null}).cohort).toBe('ordinary');});
it('matches Source counters/cohorts without constructing synthetic receipts',()=>{
 const resolution={actor:'automatic-poll',resolvedAt:updated,evidence:{queryRunFound:true},action:'repair_completed',reason:'saved_real_query_run'};
 const source:A2aOperationsRow[]=[{status:'completed',createdAt:created,updatedAt:updated,startedAt:started,executionJournalVersion:1,researchPackage:pkg,serviceReceipt:receipt,resolution:null},{status:'completed',createdAt:created,updatedAt:updated,startedAt:started,resolution},{status:'completed',createdAt:'invalid',updatedAt:updated,startedAt:null,resolution:{}},{status:'running',createdAt:created,updatedAt:updated,startedAt:null},{status:'failed',createdAt:created,updatedAt:updated,startedAt:started}];
 const now=Date.parse(updated)+10000,recorded=source.map(r=>({status:r.status,createdAt:r.createdAt,updatedAt:r.updatedAt,startedAt:r.startedAt,completionCohort:recordedCompletionCohort(r)}));expect(summarizeNativeRecordedJobs(recorded,now)).toEqual(summarizeA2aOperations(source,now,true));
});
it('retains legacy health observations without minting an acceptance binding',()=>{const p=acceptanceOriginalMetadata(row(),randomUUID());expect(p.health.cohort).toBe('ordinary');expect(p.binding).toBeNull();expect(p.network).toBeNull();});
