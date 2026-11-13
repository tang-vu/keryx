/** Private Source adaptation of the existing choice journal, behind fixed native
 * wrappers only. This does not grant ordinary RPC or complete-writer admission. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeLedgerSource } from './ledger-source.mts';
export function nativeAcceptanceSource(){
 const base=nativeLedgerSource(),read=(name:string)=>readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n');
 const ordinary=read('../../supabase/migrations/0087_deliverable_acceptance.sql');
 const found=[...ordinary.matchAll(/create function public\.deliverable_acceptance_submit_v1\([\s\S]*?\nend; \$\$;/g)];if(found.length!==1)throw Error('Acceptance submit SOURCE changed');
 let submit=found[0][0];const guards=[...submit.matchAll(/  if jsonb_typeof\(p_input\)[\s\S]*?then raise exception 'acceptance_unavailable'; end if;/g)];if(guards.length!==1)throw Error('Acceptance input SOURCE changed');
 const input=guards[0][0].replace("then raise exception 'acceptance_unavailable'; end if;",'then return false; end if;');
 const inputFunction=`CREATE FUNCTION keryx_storage.acceptance_input_valid(p_input jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ BEGIN\n${input}\nRETURN true;EXCEPTION WHEN OTHERS THEN RETURN false;END;$$;`;
 const replace=(before:string,after:string)=>{if(submit.split(before).length!==2)throw Error('Acceptance submit SOURCE shape changed');submit=submit.replace(before,()=>after);};
 replace('public.deliverable_acceptance_submit_v1','keryx_storage.acceptance_submit_business');
 replace('  perform public.deliverable_acceptance_ordinary_v1();','');
 replace(guards[0][0],"  IF NOT keryx_storage.acceptance_input_valid(p_input) THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;");
 submit=submit.replaceAll('public.deliverable_acceptance_bundle_v1','keryx_storage.acceptance_bundle');
 replace('select data into replay','select data::jsonb into replay');
 replace(',entry);',',entry::text);');
 // SOURCE uses the pinned JavaScript trim set, matching parseScopes exactly.
 const whitespace:number[]=[];for(let n=0;n<=0x10ffff;n++){const c=String.fromCodePoint(n);if(c.trim()==='')whitespace.push(n);}if(whitespace.length!==25)throw Error('JavaScript trim SOURCE changed');
 replace('btrim(value)','btrim(value,'+whitespace.map(n=>'chr('+n+')').join('||')+')');
 const projection=read('../../ops/keryx-postgres/acceptance-projection.sql'),operations=read('../../ops/keryx-postgres/acceptance.sql');
 if(Buffer.byteLength(projection)>16384||Buffer.byteLength(operations)>32768)throw Error('Acceptance SOURCE bound');
 const sql=base.sql+'\n'+projection+'\nSET ROLE keryx_owner;\n'+inputFunction+'\n'+submit+'\nRESET ROLE;\n'+operations;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Current native choice-journal SOURCE candidate. Exact retained original, native/genuine SQLite, factory, future A2A original publication, full writer/import/load/cutover gates remain required.'});
}
