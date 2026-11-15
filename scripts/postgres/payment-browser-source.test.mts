import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {nativeA2aFulfillmentSource} from './a2a-fulfillment-source.mts';
import {nativePaymentBrowserSource,LEGACY_PAYMENT_OBSERVERS,SOURCE_PAYMENT_OBSERVERS,LEGACY_PAYMENT_CONSUMED_FIELDS,KNOWN_PAYMENT_UNPROJECTED_FIELDS} from './payment-browser-source.mts';

it('keeps every declared payment observer and the seven transitive financial paths inside the raw guard',()=>{
 const base=nativeA2aFulfillmentSource().sql,closed=new Set<string>([...LEGACY_PAYMENT_OBSERVERS,...SOURCE_PAYMENT_OBSERVERS]);
 const missing=[...base.matchAll(/\('([a-z0-9_]+)'\s*,\s*ARRAY\[([^\]]*)\]/g)].filter(m=>m[2].includes("'payment_events'")&&!closed.has(m[1])).map(m=>m[1]);
 expect([...new Set(missing)]).toEqual([]);
 for(const name of ['activate_browser_journal','resolve_a2a_order','creator_owner_accounting','creator_owner_admit','session_withdrawal_accounting','reserve_session_withdrawal','owner_assignment_act'])expect(closed.has(name)).toBe(true);
 expect(new Set(LEGACY_PAYMENT_OBSERVERS).size).toBe(56);
 for(const name of Object.keys(LEGACY_PAYMENT_CONSUMED_FIELDS)){expect(LEGACY_PAYMENT_OBSERVERS).toContain(name);expect(SOURCE_PAYMENT_OBSERVERS).not.toContain(name);}
});
it('builds the fresh replacement without any obsolete generic writer or extra payment helper',()=>{
 const {sql}=nativePaymentBrowserSource();
 for(const name of ['record_payment','record_payment_once','settle_pending_payment'])expect(sql).not.toContain('public.storage_'+name+'(');
 expect([...sql.matchAll(/CREATE FUNCTION public\.storage_(payment_events|browser_journal|browser_journal_evidence)\(/g)].map(m=>m[1]).sort()).toEqual(['browser_journal','browser_journal_evidence','payment_events']);
 expect(sql).not.toContain('{{LEGACY_PAYMENT_OPERATIONS}}');expect(sql).not.toContain('{{SOURCE_PAYMENT_OPERATIONS}}');
 expect(sql).not.toContain('{{KNOWN_PAYMENT_UNPROJECTED_FIELDS}}');expect(sql).not.toContain('{{LEGACY_PAYMENT_CONSUMED_FIELDS}}');
 expect(sql).not.toContain('{{CONSUMED_PAYMENT_OPERATIONS}}');
 const start=sql.indexOf('anchor:=E\' IF policy.read_only'),guard=sql.indexOf('Native payment raw observation guard v1',start);
 expect(start).toBeGreaterThan(0);expect(guard).toBeGreaterThan(start);expect(sql.slice(start,guard)).toContain('634781904177022');
});
it('keeps the five finite consumed-field cases closed without changing other legacy guards',()=>{
 const {sql}=nativePaymentBrowserSource(true),start=sql.indexOf('-- Native payment raw observation guard v1'),end=sql.indexOf('$observation$)',start),guard=sql.slice(start,end);
 const cases=[...guard.matchAll(/WHEN '([a-z0-9_]+)' THEN r\.unprojected_fields && ARRAY\[([^\]]+)\]::text\[\]/g)];
 expect(cases.map(m=>m[1]).sort()).toEqual(['creator_owner_accounting','creator_owner_admit','reserve_session_withdrawal','session_funding_accounting','session_withdrawal_accounting']);
 for(const row of cases)expect(row[2]).toContain("'tx_hash'");
 expect(guard).toContain('IS NOT TRUE');expect(guard).toContain('ELSE true END');expect(KNOWN_PAYMENT_UNPROJECTED_FIELDS).toHaveLength(12);
 expect(guard.indexOf('native payment raw original coverage or projection unavailable')).toBeLessThan(guard.indexOf('CASE selected'));
 expect(guard).toContain('r.native_projection IS DISTINCT FROM to_jsonb(p)');expect(guard).toContain('r.identity_digest IS DISTINCT FROM stored.identity_digest');
 expect(guard).not.toContain('source_scalar_text');expect(sql).toContain('native payment observation complete quoted definition bound');
 const receipt=guard.match(/IF selected=ANY\(ARRAY\[([^\]]*)\]::text\[\]\)\s+AND EXISTS\(SELECT 1 FROM public\.payment_events p WHERE p\.tx_hash IS NOT NULL AND btrim\(p\.tx_hash\)<>''/);
 expect(receipt).not.toBeNull();expect(receipt![1].match(/'([a-z0-9_]+)'/g)?.map(s=>s.slice(1,-1)).sort()).toEqual(Object.keys(LEGACY_PAYMENT_CONSUMED_FIELDS).sort());
 expect(guard).toContain('native payment receipt whitespace outside qualified financial scope');
});
it('uses only safe payment keys in deferred coherence and preserves independent original retention',()=>{
 const sql=readFileSync(new URL('../../ops/keryx-postgres/payment-observation.sql',import.meta.url),'utf8');
 expect(sql).not.toMatch(/to_jsonb\((?:OLD|NEW)\)/i);
 expect(sql).toContain('payment_coherence_id:=NEW.payment_id');expect(sql).toContain('payment_coherence_id:=NEW.id');
 expect(sql.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(2);
 expect(sql).toContain('Native payment Source original fence v1');
});
