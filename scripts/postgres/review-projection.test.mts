import { describe,it,expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createSqliteDecisionReviews } from '../../lib/db/decision-reviews-sqlite';
import { auditReviews } from './audit-reviews.mts';
const owner='0x'+'a1'.repeat(20);
describe('bounded private review original audit',()=>{
 it('uses exact retained bytes without publishing source or reason text',async()=>{
  const db=new DatabaseSync(':memory:');try{const store=createSqliteDecisionReviews(db),row=await store.capture(owner,{policyVersion:'captured-owner-decisions-v1',engine:'synthetic',requestedModel:null,runId:randomUUID(),round:0,ordinal:0,sourceName:'PRIVATE\0source 🌍',modelAction:'BUY',codeAction:'BUY',codeRule:'selected',reviewFirst:true,cohort:'unknown',cohortEvidence:null,terms:{assetId:'one',sourceId:'one',owned:true,network:'eip155:5042',payTo:owner,priceMicroUsdc:'1',listPriceMicroUsdc:'1',citationBudgetMicroUsdc:'1'}},Date.parse('2026-10-09T10:00:00.000Z'));
   expect(()=>auditReviews(db,performance.now()+1000)).toThrow();db.exec('BEGIN');const before=auditReviews(db,performance.now()+1000);expect(before).toMatchObject({reviewRows:1,verdictRows:0,invalidRows:0,invalidVerdicts:0,nulSourceNames:1,originalsModified:false});expect(JSON.stringify(before)).not.toContain('PRIVATE');expect(()=>auditReviews(db,performance.now()-1)).toThrow();db.exec('ROLLBACK');
   db.prepare("UPDATE decision_review_records SET run_id=? WHERE id=?").run(randomUUID(),row.id);db.exec('BEGIN');const invalid=auditReviews(db,performance.now()+1000);expect(invalid.invalidRows).toBe(1);expect(invalid.projectionDigest).not.toBe(before.projectionDigest);db.exec('ROLLBACK');
  }finally{db.close();}
 });
});
