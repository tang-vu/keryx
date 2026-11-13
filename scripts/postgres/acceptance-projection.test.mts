import { expect,it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { acceptanceFixture } from '../../lib/deliverable-acceptance/test-fixture';
import { acceptanceOriginalMetadata } from '../../lib/db/postgres/acceptance-metadata';
import { sqliteAcceptanceProjection } from './acceptance-projection.mts';
import { auditAcceptance } from './audit-acceptance.mts';
it('preserves the exact existing customer original and delivered fingerprints without changing source rows',async()=>{
 const f=await acceptanceFixture();try{const db=Reflect.get(f.db,'db') as DatabaseSync,order=db.prepare('SELECT * FROM a2a_orders WHERE id=?').get(f.fixture.order.id)!,before=JSON.stringify(order),p=sqliteAcceptanceProjection(db,f.fixture.order.id);
  expect(p.binding).toMatchObject({originalFingerprint:f.snapshot.originalFingerprint,deliveredDigest:f.snapshot.deliveredDigest,answerDigest:f.snapshot.answerDigest,paidMicros:f.snapshot.paidMicros});expect(p.network).toBe(f.fixture.binding.network);expect(p.orderWire).toBe(before);expect(JSON.parse(p.deliveryToken)).toBe(order.response_data);expect(JSON.stringify(db.prepare('SELECT * FROM a2a_orders WHERE id=?').get(f.fixture.order.id))).toBe(before);
 }finally{f.db.close();}
});
it('retains source key order and store identity instead of allocating a fingerprint from normalized JSON',async()=>{
 const f=await acceptanceFixture();try{const db=Reflect.get(f.db,'db') as DatabaseSync,p=sqliteAcceptanceProjection(db,f.fixture.order.id),row=JSON.parse(p.orderWire),reordered=Object.fromEntries(Object.entries(row).reverse());
  expect(acceptanceOriginalMetadata(reordered,p.storeId).binding?.originalFingerprint).not.toBe(p.binding!.originalFingerprint);expect(acceptanceOriginalMetadata(row,randomUUID()).binding?.originalFingerprint).not.toBe(p.binding!.originalFingerprint);expect(acceptanceOriginalMetadata({...row,status:'running'},p.storeId).binding).toBeNull();
 }finally{f.db.close();}
});
it('audits historical choices against the exact owner/original tuple and exports only counts and digests',async()=>{
 const f=await acceptanceFixture();try{const db=Reflect.get(f.db,'db') as DatabaseSync;await f.port.submit(f.fixture.order.payer,f.fixture.binding.network,f.fixture.order.id,{...f.input,publishState:true,reason:'PRIVATE-REASON'},f.authority);
  db.prepare('INSERT INTO deliverable_acceptance_entries SELECT ?,network,original_id,revision,idempotency_key,original_fingerprint,delivered_digest,data FROM deliverable_acceptance_entries').run('0x'+'ef'.repeat(20));db.exec('BEGIN');try{const report=auditAcceptance(db,performance.now()+10000,f.fixture.binding.network);expect(report).toMatchObject({orders:1,eligibleOriginals:1,entries:2,invalidEntries:0,matchingOriginalEntries:1,matchingHistoricalConsents:1,originalsModified:false,settlementAuthenticated:false});expect(JSON.stringify(report)).not.toMatch(/PRIVATE-|Synthetic delivered|0xefef/);}finally{db.exec('ROLLBACK');}
 }finally{f.db.close();}
});
