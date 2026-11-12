/** Fixed operational SOURCE only, independently installed before sealing. */
import { createHash } from 'node:crypto';
import { nativeAuthApplicationSource } from './auth-domain-source.mts';
import { nativeApplicationJsonEntrySource } from './source-json-entries.mts';
import { BASE_APPLICATION_WRITE_OPERATIONS } from '../../lib/db/postgres/application-domain-transport';
import { OPERATIONAL_WRITE_OPERATIONS } from '../../lib/db/postgres/operational-write-calls';
export function nativeOperationalApplicationSource(){
 const base=nativeAuthApplicationSource(),names=Object.keys(BASE_APPLICATION_WRITE_OPERATIONS);
 if(names.length!==17||Object.keys(OPERATIONAL_WRITE_OPERATIONS).length!==11)throw new Error('Operational source inventory changed; review required');
 const sql=base.sql+`\nSET ROLE keryx_owner;
CREATE OR REPLACE FUNCTION keryx_storage.enter_operation(expected jsonb,selected text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>'keryx_app' OR current_setting('transaction_read_only')<>'off'
  OR selected<>ALL(ARRAY[${names.map(n=>"'"+n+"'").join(',')}])
  OR expected IS DISTINCT FROM(SELECT identity FROM keryx_storage.identity WHERE singleton)
  OR (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'active'
  OR NOT EXISTS(SELECT 1 FROM keryx_storage.writer WHERE transaction_id=txid_current() AND operation=selected AND identity_digest=keryx_storage.identity_digest(expected))
 THEN RAISE EXCEPTION 'native operational context refused';END IF;
END;$$;
ALTER TABLE public.api_keys ALTER COLUMN created_at DROP DEFAULT;
ALTER TABLE public.api_keys ALTER COLUMN created_at TYPE text USING created_at::text;
ALTER TABLE public.api_keys ALTER COLUMN last_used_at TYPE text USING last_used_at::text;
ALTER TABLE public.api_keys ALTER COLUMN revoked_at TYPE text USING revoked_at::text;
ALTER TABLE public.answer_feedback ALTER COLUMN created_at DROP DEFAULT;
ALTER TABLE public.answer_feedback ALTER COLUMN created_at TYPE text USING created_at::text;
-- The old SQL body used unqualified tables. This private call inherits the
-- fixed native entry's restricted search_path, so all relations stay explicit.
CREATE OR REPLACE FUNCTION public.upsert_api_key_usage(p_key_id text,p_day date) RETURNS void LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO public.api_key_usage(key_id,day,call_count) VALUES(p_key_id,p_day,1)
 ON CONFLICT(key_id,day) DO UPDATE SET call_count=public.api_key_usage.call_count+1;
$$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['rate_limit_counters','reasoning_circuits','api_keys','api_key_usage','answer_feedback','activation_events'] LOOP
 EXECUTE format('CREATE TRIGGER native_operational_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence()',t);
END LOOP;END;$$;
${nativeApplicationJsonEntrySource(Object.keys(OPERATIONAL_WRITE_OPERATIONS),true)}
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
`;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Operational source/domain only. Complete runtime factory and production migration remain unqualified.'});
}
