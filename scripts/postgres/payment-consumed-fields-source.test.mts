import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createPaymentConsumedFieldsFixture} from './payment-consumed-fields-fixture.mts';
import {STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity} from '../../lib/db/storage-identity';
import {PAYMENT_EVENT_FIELDS} from '../../lib/db/postgres/payment-events-packet';
import {LEGACY_PAYMENT_CONSUMED_FIELDS,KNOWN_PAYMENT_UNPROJECTED_FIELDS} from './payment-browser-source.mts';

const expectedColumns=['id','network','authorization_id','grant_epoch','payer','payee','amount_usdc','settled','settlement_status','authorization_phase','tx_hash'];
it('binds each finite mapping to the existing transitive financial helper columns',()=>{
 const read=(name:string)=>readFileSync(new URL('../../ops/keryx-postgres/'+name,import.meta.url),'utf8');
 const funding=read('session-funding.sql').match(/CREATE FUNCTION keryx_storage\.session_funding_totals[\s\S]*?END;\s*\$\$;/)![0];
 expect([...new Set([...funding.matchAll(/\bp\.([a-z0-9_]+)/g)].map(m=>m[1]))].sort()).toEqual([...expectedColumns].sort());
 expect(funding).not.toContain('p.created_at');expect(funding).toContain('SELECT i.*,');expect(funding).toContain('r.created_at::timestamptz>baseline');
 const hosted=read('hosted-ledger.sql').match(/CREATE FUNCTION keryx_storage\.hosted_totals[\s\S]*?END;\s*\$\$;/)![0];
 const hostedPaymentFields=[...new Set([...hosted.matchAll(/\br\.([a-z0-9_]+)/g)].map(m=>m[1]))].filter(name=>(PAYMENT_EVENT_FIELDS as readonly string[]).includes(name));
 expect(hostedPaymentFields.sort()).toEqual(['id','network','authorization_id','payer','payee','amount_usdc','settled','settlement_status','tx_hash'].sort());
 const withdrawals=read('session-withdrawals.sql'),owner=read('owner-withdrawals.sql');
 expect(withdrawals).toContain('funding:=keryx_storage.session_funding_totals(signer,NULL)');
 expect(owner).toContain('session:=keryx_storage.session_funding_totals(owner_addr,NULL);hosted:=keryx_storage.hosted_totals(owner_addr,NULL)');
 for(const fields of Object.values(LEGACY_PAYMENT_CONSUMED_FIELDS))expect(fields).toEqual(expectedColumns);
 expect(Object.isFrozen(LEGACY_PAYMENT_CONSUMED_FIELDS)).toBe(true);expect(Object.isFrozen(KNOWN_PAYMENT_UNPROJECTED_FIELDS)).toBe(true);
 for(const unsupported of ['future_field','amount_usdc','weight','settled','id','kind','query_id',null])expect(KNOWN_PAYMENT_UNPROJECTED_FIELDS).not.toContain(unsupported);
 const guard=read('payment-observation.sql'),trim=guard.match(/btrim\(p\.tx_hash,U&'([^']+)'\)/)![1];
 const whitespace=[...trim.matchAll(/\\([0-9A-F]{4})/g)].map(m=>Number.parseInt(m[1],16));
 const sourceSet:number[]=[];for(let n=0;n<=0x10ffff;n++)if(String.fromCodePoint(n).trim()==='')sourceSet.push(n);
 expect(whitespace).toEqual(sourceSet);expect(whitespace).toHaveLength(25);
});

// The shared helper is pure Node/actual Source, never a Vitest/app runtime.
const expectedIdentity=()=>validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:'eip155:5042',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:new Date().toISOString(),provenanceDigest:'71'.repeat(32)});
it('accepts only a fresh synthetic expected identity and retains exact Source cells for native intake',()=>{
 expect(()=>createPaymentConsumedFieldsFixture(undefined)).toThrow();expect(()=>createPaymentConsumedFieldsFixture({...expectedIdentity(),extra:true})).toThrow();
 const fixture=createPaymentConsumedFieldsFixture(expectedIdentity());try{
  const snapshot=fixture.snapshot();expect(snapshot.payments).toHaveLength(3);expect(snapshot.tables.browser_journal_control).toEqual([{id:1,active:1}]);
  for(const grant of snapshot.tables.session_grants)expect(Number(grant.expiry)-Date.now()).toBeGreaterThan(3500000);
  for(const payment of snapshot.payments){expect(Object.keys(payment.row).sort()).toEqual([...PAYMENT_EVENT_FIELDS].sort());expect(JSON.parse(payment.rowWire)).toEqual(payment.row);}
  const helper=readFileSync(new URL('./payment-consumed-fields-fixture.mts',import.meta.url),'utf8');expect(helper).not.toMatch(/from ['"]vitest/);expect(helper).not.toContain('SqliteAdapter');expect(helper).not.toMatch(/from ['"][^'"]*(?:runtime-adapter|supabase-adapter|config)['"]/);
 }finally{fixture.close();}
});
it('proves Source ignores payment presentation/date gaps while valid padded receipts stay eligible',()=>{
 const fixture=createPaymentConsumedFieldsFixture(expectedIdentity());try{
  const baseline=fixture.read(),packet=fixture.addPresentationGaps();
  expect(packet.unprojectedFields).toEqual(['authorization_expires_at','content_version','created_at','item_published_at','item_title','item_url','origin','rationale','source_name']);
  expect(packet.row.source_name).toBe('\ufeffsource\0lone\ufffd');expect(packet.row.created_at).toBe('invalid\0payment-date');expect(fixture.read()).toEqual(baseline);
  const changes=fixture.changes();fixture.read();expect(fixture.changes()).toBe(changes);
  fixture.expose('padded');fixture.settlePadded();expect(fixture.read().funding.confirmedSpentMicroUsdc).toBe('1');expect(fixture.read().confirmed).toBe(1);expect(fixture.payment('padded').unprojectedFields).not.toContain('tx_hash');
  fixture.expose('nul');fixture.settleNul();expect(fixture.read('nul').confirmed).toBe(1);expect(fixture.payment('nul').row.tx_hash).toBe('receipt\0retained');expect(fixture.payment('nul').projection.tx_hash).toBeNull();expect(fixture.payment('nul').unprojectedFields).toContain('tx_hash');
  for(const fields of Object.values(LEGACY_PAYMENT_CONSUMED_FIELDS))expect(fields).toContain('tx_hash');
 }finally{fixture.close();}
});
it('uses genuine independent Source terminal calls for each representable trim-empty negative',()=>{
 for(const kind of ['space','tab','bom','ideographic'] as const){const fixture=createPaymentConsumedFieldsFixture(expectedIdentity());try{
  fixture.expose('whitespace');fixture.settleWhitespace(kind);expect(fixture.payment('whitespace').unprojectedFields).not.toContain('tx_hash');
  expect(()=>fixture.read('whitespace')).toThrow('Original settled debit');fixture.assertRefused('whitespace');
 }finally{fixture.close();}}
});
