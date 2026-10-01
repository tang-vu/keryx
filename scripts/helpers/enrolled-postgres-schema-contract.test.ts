import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileFunctionDeclarationManifest, exportPostgres17SchemaContract,
  POSTGRES17_SCHEMA_CONTRACT_BODY, POSTGRES17_SCHEMA_CONTRACT_QUERY } from './enrolled-postgres-schema-contract.mjs';

const sections=['database','schemas','relations','columns','constraints','indexes','triggers','functions','policies',
  'defaults','roles','memberships','roleSettings','inheritance','sequenceOwnership','sequences','types','rules','collations','operations'];
function contract() { return {format:'keryx-postgres17-runtime-contract-v1',major:17,
  sections:Object.fromEntries(sections.map(section=>[section,[] as unknown[]]))}; }

describe('source-owned PostgreSQL17 schema export',()=>{
  it('preserves ACL grantors, grant options, search paths and literal operation scope in the digest',()=>{
    const input=contract();
    input.sections.functions=[{name:'read',settings:['search_path=pg_catalog, pg_temp'],acl:{explicit:true,grants:[{grantor:'owner',grantee:'service_role',privilege:'EXECUTE',grantable:false}]}}];
    input.sections.operations=[{operation:'read',relations:['sources'],realOnly:false,readOnly:true}];
    const original=exportPostgres17SchemaContract(input);
    for(const change of [()=>{input.sections.operations[0]={operation:'read',relations:['session_grants'],realOnly:false,readOnly:true};},
      ()=>{input.sections.functions[0]={name:'read',settings:['search_path=public, pg_temp']};},
      ()=>{input.sections.functions[0]={name:'read',acl:{explicit:true,grants:[{grantor:'owner',grantee:'service_role',privilege:'EXECUTE',grantable:true}]}};}]){
      change();expect(exportPostgres17SchemaContract(input).sha256).not.toBe(original.sha256);
    }
    expect(original.canonicalJson).toContain('pg_catalog, pg_temp');
  });
  it('canonicalizes property/row ordering without rounding bigint sequence terms',()=>{
    const a=contract();a.sections.sequences=[{name:'b',maximum:'9223372036854775807'},{name:'a',maximum:'9223372036854775806'}];
    const b=contract();b.sections.sequences=[{maximum:'9223372036854775806',name:'a'},{maximum:'9223372036854775807',name:'b'}];
    expect(exportPostgres17SchemaContract(a).canonicalJson).toBe(exportPostgres17SchemaContract(b).canonicalJson);
    b.sections.sequences[0]={name:'a',maximum:9223372036854775807};
    expect(()=>exportPostgres17SchemaContract(b)).toThrow('schema contract refused');
  });
  it('rejects over-budget and accessor/sparse/symbol metadata without invoking accessors',()=>{
    const a=contract();a.sections.functions=Array.from({length:513},()=>({name:'f'}));
    expect(()=>exportPostgres17SchemaContract(a)).toThrow();
    a.sections.functions=[{body:'x'.repeat(131073)}];expect(()=>exportPostgres17SchemaContract(a)).toThrow();
    let accessed=false;const evil=Object.defineProperty({},'name',{enumerable:true,get(){accessed=true;return 'f';}});
    a.sections.functions=[evil];expect(()=>exportPostgres17SchemaContract(a)).toThrow();expect(accessed).toBe(false);
    const array:unknown[]=[];Object.defineProperty(array,'0',{enumerable:true,get(){accessed=true;return {};}});
    a.sections.functions=array;expect(()=>exportPostgres17SchemaContract(a)).toThrow();expect(accessed).toBe(false);
    a.sections.functions=new Array(1);expect(()=>exportPostgres17SchemaContract(a)).toThrow();
    a.sections.functions=[{[Symbol('hidden')]:true}];expect(()=>exportPostgres17SchemaContract(a)).toThrow();
    a.sections.functions=Array.from({length:65},()=>({body:'x'.repeat(131000)}));
    expect(()=>exportPostgres17SchemaContract(a)).toThrow();
  });
  it('exposes a fixed PG17 read-only query and pre-export count/source bounds',()=>{
    expect(POSTGRES17_SCHEMA_CONTRACT_QUERY).toContain('repeatable read read only');
    expect(POSTGRES17_SCHEMA_CONTRACT_BODY.indexOf('schema contract count bound')).toBeLessThan(POSTGRES17_SCHEMA_CONTRACT_BODY.indexOf('with entries as'));
    expect(POSTGRES17_SCHEMA_CONTRACT_BODY).toContain('from aclexplode(');
    expect(POSTGRES17_SCHEMA_CONTRACT_BODY).toContain('t.tgisinternal then null');
    expect(POSTGRES17_SCHEMA_CONTRACT_BODY).toContain('m.inherit_option');
    expect(POSTGRES17_SCHEMA_CONTRACT_BODY).toContain('from keryx_storage.operations');
    expect(POSTGRES17_SCHEMA_CONTRACT_BODY).not.toContain('daticulocale');
  });
  it('budgets raw trigger arguments at hex size and qualifier nodes before descriptor allocation',()=>{
    const preflight=POSTGRES17_SCHEMA_CONTRACT_BODY.slice(0,POSTGRES17_SCHEMA_CONTRACT_BODY.indexOf('with entries as'));
    // Inspect the complete emitted raw-field gate, not a separate JS surrogate:
    // changing to raw byte length, int multiplication, or post-encode measurement
    // must fail even though the eventual output exporter would also reject it.
    expect(preflight).toMatch(/2::bigint\*octet_length\(t\.tgargs\)::bigint\+octet_length\(coalesce\(t\.tgqual::text,''\)\)::bigint from pg_trigger t join pg_class c on c\.oid=t\.tgrelid join pg_namespace n on n\.oid=c\.relnamespace where n\.nspname in \('public','keryx_storage'\)/u);
    expect(preflight).toContain('max(fields.bytes),0)<=131072');
    expect(preflight).toContain('bytes>8388608');
    expect(preflight).not.toMatch(/encode\(|pg_get_expr\(|pg_get_triggerdef\(/u);
    const metadata=contract();
    metadata.sections.triggers=[{args:'ab'.repeat(65537),when:null}];
    expect(()=>exportPostgres17SchemaContract(metadata)).toThrow();
    metadata.sections.triggers=[{args:'',when:'q'.repeat(131073)}];
    expect(()=>exportPostgres17SchemaContract(metadata)).toThrow();
  });
});

describe('reviewed source function declaration manifest',()=>{
  it('does not interpret fake DDL inside nested comments, escaped quotes or dollar bodies',()=>{
    const events=compileFunctionDeclarationManifest([{name:'0001_example.sql',sql:`
      /* create function bad(); /* nested */ */
      CREATE FUNCTION public."CaseName"(x text DEFAULT 'a;''b') RETURNS text LANGUAGE sql AS $body$
        select 'DROP FUNCTION public.good();'; -- not a declaration
      $body$;
      CREATE OR REPLACE FUNCTION public.good(x jsonb) RETURNS jsonb AS $$ select x $$ LANGUAGE sql;
      ALTER FUNCTION public.good(jsonb) RENAME TO renamed;
      DROP FUNCTION IF EXISTS public.renamed(jsonb);
    `}]);
    expect(events.map(e=>[e.action,e.name])).toEqual([['create','public."CaseName"'],['replace','public.good'],['rename','public.good'],['drop','public.renamed']]);
    expect(events[0].body).toContain('DROP FUNCTION public.good()');expect(events[2].renamedTo).toBe('renamed');
    expect(()=>compileFunctionDeclarationManifest([{name:'0001_bad.sql',sql:'create function f() returns void as $x$ unfinished'}])).toThrow();
    expect(()=>compileFunctionDeclarationManifest([{name:'0002_later.sql',sql:''},{name:'0001_earlier.sql',sql:''}])).toThrow();
    let called=false;
    const hostile=Object.defineProperty({name:'0001_hostile.sql'},'sql',{enumerable:true,get(){called=true;return ''}});
    expect(()=>compileFunctionDeclarationManifest([hostile as {name:string;sql:string}])).toThrow();expect(called).toBe(false);
  });
  it('retains fixed dynamic templates/allowlists instead of deriving declarations from target bodies',()=>{
    const events=compileFunctionDeclarationManifest([{name:'0001_generated.sql',sql:`do $outer$
      declare names text[]:=array['safe_read','safe_write']; begin
      execute format($template$create function public.%I() returns void as $body$ begin return; end $body$ language plpgsql$template$,names[1]);
      end; $outer$;`}]);
    expect(events).toHaveLength(1);expect(events[0].action).toBe('generated');
    expect(events[0].generatedLiterals).toContain('safe_read');
    expect(events[0].generatedLiterals?.some(value=>value.startsWith('create function public.%I'))).toBe(true);
  });
  it('captures actual ordered repository declarations, renames and both enrolled generators',()=>{
    const dir=resolve('supabase/migrations');
    const inputs=readdirSync(dir).filter(name=>/^\d{4}_.+\.sql$/u.test(name)&&Number(name.slice(0,4))<=76).sort()
      .map(name=>({name,sql:readFileSync(resolve(dir,name),'utf8')}));
    const events=compileFunctionDeclarationManifest(inputs);
    expect(events.some(e=>e.renamedTo==='browser_signing_legacy_signature_internal')).toBe(true);
    expect(events.some(e=>e.renamedTo==='browser_signing_v2_admission_internal')).toBe(true);
    const generated=events.filter(e=>e.action==='generated');
    expect(generated.some(e=>e.migration==='0074_enrolled_storage_domain_apis.sql')).toBe(true);
    expect(generated.some(e=>e.migration==='0075_enrolled_storage_domain_wrappers.sql')).toBe(true);
    expect(events.some(e=>e.name==='keryx_storage.catalog_contract'&&e.body?.includes('jsonb'))).toBe(true);
  });
});
