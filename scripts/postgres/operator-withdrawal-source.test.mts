import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {OPERATOR_WITHDRAWAL_CALLS} from '../../lib/db/postgres/operator-withdrawal-calls';
const sql=readFileSync(new URL('../../ops/keryx-postgres/operator-withdrawal.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
it('preserves the function budget with fresh-only complete bounded fixed router replacements',()=>{
 expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(32768);expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s/i);expect(sql).toContain("OR EXISTS(SELECT 1 FROM keryx_storage.identity)");
 for(const signature of ['keryx_storage.write_fence()','keryx_storage.require_operation(jsonb,text,text)','public.storage_application_operational_write(jsonb,text,text,jsonb)','public.storage_application_read_group_8(jsonb,text,text,jsonb)'])expect(sql).toContain("pg_get_functiondef('"+signature+"'::regprocedure)");
 expect(sql.match(/octet_length\(to_jsonb\(replace\(definition,body,extended\)\)::text\)>32768/g)).toHaveLength(4);
});
it('keeps independent exact read/write descriptors and immutable identity-bound first reporting originals',()=>{
 expect(OPERATOR_WITHDRAWAL_CALLS.operatorSourceInventory).toMatchObject({write:false,transaction:true,bytes:4194304});expect(OPERATOR_WITHDRAWAL_CALLS.withdrawalSourceRecord).toMatchObject({write:true,bytes:128});
 for(const op of ['operator_source_inventory','operator_source_public','record_withdrawal'])expect(Object.values(OPERATOR_WITHDRAWAL_CALLS).some(call=>call.sql.includes("'"+op+"'"))).toBe(true);
 expect(sql).toContain('withdrawal Source original immutable');expect(sql).toContain('r.identity_digest IS DISTINCT FROM stored.identity_digest');expect(sql).toContain('r.native_projection IS DISTINCT FROM to_jsonb(w)');
 expect(sql).toContain("c->>'network' IS DISTINCT FROM encode(convert_to(expected->>'network','UTF8'),'hex')");expect(sql.match(/DEFERRABLE INITIALLY DEFERRED FOR EACH ROW/g)).toHaveLength(2);
});
it('refuses every named legacy observer rather than returning incomplete scalar shadows',()=>{
 for(const op of ['list_withdrawals','record_supabase_withdrawal_2','settlement_ledger_2'])expect(sql).toContain("'"+op+"'");
 expect(sql).toContain('cardinality(unprojected_fields)>0');expect(sql).toContain('withdrawal Source original unavailable to legacy observer');expect(sql).toContain('operator complete inventory rows');expect(sql).toContain('operator complete inventory bytes');
});
