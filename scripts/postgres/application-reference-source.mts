/** Build-time SOURCE reference only. This composes existing native table/domain
 * source with the qualified mainnet ledger; it grants no KeryxDB readiness,
 * target discovery, installation on an existing namespace or runtime selection. */
import { readFileSync,readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { nativeCatalogBody,nativePostgres17DescriptorBody } from "./native-catalog-body.mts";
import { ARC_MAINNET_PROFILE,ARC_TESTNET_PROFILE } from "../../lib/arc-network-profile";
import { nativeDomainAuthoritySource,nativeOwnerWithdrawalSource } from "./native-domain-source.mts";

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function replaceOnce(sql:string,before:string,after:string){
  if(sql.split(before).length!==2)throw new Error('Application reference source adaptation refused');return sql.replace(before,()=>after);
}
export function nativeApplicationFinancialReferenceSource(){
  const directory=new URL('../../supabase/migrations/',import.meta.url);
  const inputs=readdirSync(directory).filter(n=>/^\d{4}_[a-z0-9_]+\.sql$/.test(n)&&Number(n.slice(0,4))<=72).sort()
    .map(name=>({name,sql:readFileSync(new URL(name,directory),'utf8').replaceAll('\r\n','\n')}));
  if(inputs.at(-1)?.name!=='0072_browser_source_context.sql')throw new Error('Application reference input inventory refused');
  let base=inputs.map(i=>i.sql).join('\n');
  if(Buffer.byteLength(base)>4*1024*1024)throw new Error('Application reference input bound exceeded');
  // Select profile constants in fresh SOURCE only. Never rewrite imported rows,
  // identities or historical testnet evidence.
  base=base.replaceAll(ARC_TESTNET_PROFILE.networkId,ARC_MAINNET_PROFILE.networkId)
    .replaceAll(String(ARC_TESTNET_PROFILE.chainId),String(ARC_MAINNET_PROFILE.chainId))
    .replaceAll(ARC_TESTNET_PROFILE.gatewayWallet.toLowerCase(),ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase());
  // Text-backed UUID domains preserve the SQLite original's representation while
  // retaining native format validation. This is SOURCE DDL, not stored-row editing.
  base=base.replace(/\buuid\b/gi,'keryx_storage.native_uuid_text');
  for(const name of ['browser_journal_write_fence','browser_journal_payment_fence']){
    const start=base.indexOf(`create function public.${name}()`);
    if(start<0)throw new Error('Legacy browser fence source unavailable');
    const at=base.indexOf('as $$\nbegin',start);
    if(at<0||at-start>512)throw new Error('Legacy browser fence source shape refused');
    const offset=at+'as $$\nbegin'.length;
    base=base.slice(0,offset)+"\n  if session_user='postgres' and (select mode from keryx_storage.control where singleton)='held' then\n    if tg_op='DELETE' then return old; else return new; end if;\n  end if;"+base.slice(offset);
  }
  const standaloneAuthority=nativeDomainAuthoritySource().sql;
  let authority=replaceOnce(replaceOnce(standaloneAuthority,nativePostgres17DescriptorBody(),nativeCatalogBody()),
    "IF NOT policy.read_only THEN INSERT INTO keryx_storage.writer VALUES(txid_current(),stored.identity_digest,selected); END IF;",
    "IF NOT policy.read_only THEN INSERT INTO keryx_storage.writer VALUES(txid_current(),stored.identity_digest,selected);\n"+
    "  IF selected=ANY(ARRAY['consume_session_grant_consent','reserve_session_withdrawal','creator_owner_admit','hosted_submit','hosted_confirm']) THEN\n"+
    "   INSERT INTO public.browser_journal_writer VALUES(txid_current()) ON CONFLICT DO NOTHING;\n  END IF;\n END IF;");
  const full=nativeOwnerWithdrawalSource().sql;
  if(!full.startsWith(standaloneAuthority+'\n'))throw new Error('Financial reference source prefix refused');
  let financial=full.slice(standaloneAuthority.length);
  financial=financial.replace(/\bCREATE TABLE public\./g,'CREATE TABLE IF NOT EXISTS public.')
    .replace(/\bCREATE (UNIQUE )?INDEX /g,(_m,u:string|undefined)=>`CREATE ${u??''}INDEX IF NOT EXISTS `)
    .replace('INSERT INTO public.browser_journal_control VALUES(1,false);','INSERT INTO public.browser_journal_control VALUES(1,false) ON CONFLICT DO NOTHING;')
    .replace('ALTER TABLE public.creator_withdrawal_requests ADD COLUMN created_at','ALTER TABLE public.creator_withdrawal_requests ADD COLUMN IF NOT EXISTS created_at');
  financial=financial.replace(/\bsettled\s+IS NOT DISTINCT FROM 1/g,'settled IS NOT DISTINCT FROM true')
    .replace(/\bsettled\s+IS DISTINCT FROM 1/g,'settled IS DISTINCT FROM true').replace(/\bsettled\s*=\s*1/g,'settled=true');
  if(/\bsettled\s*(?:=|IS (?:NOT )?DISTINCT FROM)\s*1\b/.test(financial))throw new Error('Native boolean payment adaptation incomplete');
  financial=financial.replaceAll("VALUES(r->>'id',r->>'owner',wire)","VALUES(r->>'id',r->>'owner',wire::jsonb)")
    .replace("VALUES(id,claim_id,a->>'transferId',wire)","VALUES(id,claim_id,a->>'transferId',wire::jsonb)");
  const sql=authority+"\nSET ROLE keryx_owner;\n"+
    "CREATE DOMAIN keryx_storage.native_uuid_text AS text CHECK(VALUE ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');\n"+
    base+"\n"+
    "CREATE OR REPLACE FUNCTION keryx_storage.leave_operation() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$\n DELETE FROM public.browser_journal_writer WHERE transaction_id=txid_current();\n DELETE FROM keryx_storage.writer WHERE transaction_id=txid_current();\n$$;\n"+
    // The old browser-only check requires a browser epoch for every authorization
    // phase. Mainnet hosted originals have a separate policy/nonce ledger and no
    // browser epoch; their qualified native tuple/state guards remain authoritative.
    "ALTER TABLE public.payment_events DROP CONSTRAINT browser_journal_payment_state;\n"+
    "ALTER TABLE public.creator_withdrawal_requests ALTER COLUMN created_at DROP DEFAULT;\n"+
    "ALTER TABLE public.creator_withdrawal_requests ALTER COLUMN created_at TYPE text USING to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"');\n"+
    "ALTER TABLE public.creator_withdrawal_requests ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"');\nRESET ROLE;\n"+
    financial+"\nSET ROLE keryx_owner;\nREVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;\n"+
    "DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND left(p.proname,8)<>'storage_' LOOP\n"+
    " EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader'; END LOOP; END; $$;\nRESET ROLE;\n";
  return Object.freeze({sql,sha256:hash(sql),inputFiles:inputs.map(i=>({name:i.name,sha256:hash(i.sql)})),
    limitations:'Financial-on-application-table SOURCE compatibility reference only. Remaining tables/ports, whole application admission and production cutover are not qualified.'});
}
