/** Native web-auth SOURCE composition only. It does not install/select a store. */
import { createHash } from 'node:crypto';
import { nativeCurrentApplicationSource } from './current-application-source.mts';
import { nativeApplicationJsonEntrySource } from './source-json-entries.mts';
import { AUTH_WRITE_OPERATIONS } from '../../lib/db/postgres/auth-write-calls';
export function nativeAuthApplicationSource(){
 const base=nativeCurrentApplicationSource(),names=Object.keys(AUTH_WRITE_OPERATIONS);
 const sql=base.sql+`\nSET ROLE keryx_owner;
CREATE OR REPLACE FUNCTION keryx_storage.enter_operation(expected jsonb,selected text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>'keryx_app' OR current_setting('transaction_read_only')<>'off'
  OR selected<>ALL(ARRAY[${names.map(n=>"'"+n+"'").join(',')}])
  OR expected IS DISTINCT FROM(SELECT identity FROM keryx_storage.identity WHERE singleton)
  OR (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'active'
  OR NOT EXISTS(SELECT 1 FROM keryx_storage.writer WHERE transaction_id=txid_current() AND operation=selected AND identity_digest=keryx_storage.identity_digest(expected))
 THEN RAISE EXCEPTION 'native web-auth context refused';END IF;
END;$$;
-- Fresh SOURCE columns retain the exact SQLite timestamp wire representation.
ALTER TABLE public.users ALTER COLUMN first_seen_at DROP DEFAULT;
ALTER TABLE public.users ALTER COLUMN last_seen_at DROP DEFAULT;
ALTER TABLE public.users ALTER COLUMN first_seen_at TYPE text USING first_seen_at::text;
ALTER TABLE public.users ALTER COLUMN last_seen_at TYPE text USING last_seen_at::text;
CREATE OR REPLACE FUNCTION public.storage_get_user(p_expected_identity jsonb,p_wallet_address text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN PERFORM keryx_storage.read_operation(p_expected_identity,'get_user');
 SELECT to_jsonb(u) INTO result FROM public.users u WHERE u.wallet_address=lower(p_wallet_address);RETURN result;
END;$$;
-- First-seen and display identity stay retained across concurrent sign-ins.
CREATE OR REPLACE FUNCTION public.storage_upsert_user(p_expected_identity jsonb,p_row jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM keryx_storage.enter_operation(p_expected_identity,'upsert_user');
 IF p_row IS NULL OR jsonb_typeof(p_row)<>'object' OR octet_length(p_row::text)>8192 THEN RAISE EXCEPTION 'native user input refused';END IF;
 INSERT INTO public.users(wallet_address,role,display_handle,first_seen_at,last_seen_at)
 SELECT wallet_address,role,display_handle,first_seen_at,last_seen_at FROM jsonb_populate_record(NULL::public.users,p_row)
 ON CONFLICT(wallet_address) DO UPDATE SET role=excluded.role,last_seen_at=excluded.last_seen_at;
 PERFORM keryx_storage.leave_operation();RETURN NULL;
END;$$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['auth_challenges','web_sessions','users'] LOOP
 EXECUTE format('CREATE TRIGGER native_auth_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence()',t);
END LOOP;END;$$;
${nativeApplicationJsonEntrySource(names,true)}
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_upsert_user(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
RESET ROLE;
`;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Web-auth source/domain only. Other native writes, complete runtime factory and production migration remain unqualified.'});
}
