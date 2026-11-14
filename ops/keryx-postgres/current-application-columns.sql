-- Fresh SOURCE only. Retained originals are copied separately; no backfill,
-- owner-consent admission, optional-port initialization or backend selection.
SET ROLE keryx_owner;
-- Source private clocks and inner JSON.stringify cells are TEXT. These tables
-- must be freshly empty: never reinterpret retained timestamps/JSONB as Source
-- originals, and never run this SOURCE constructor against an installed store.
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.private_research_intents) OR EXISTS(SELECT 1 FROM public.private_research_payment_attempts) OR EXISTS(SELECT 1 FROM public.private_research_executions) OR EXISTS(SELECT 1 FROM public.private_research_results) OR EXISTS(SELECT 1 FROM public.private_research_interruptions) OR EXISTS(SELECT 1 FROM public.private_creator_submissions) OR EXISTS(SELECT 1 FROM public.private_creator_confirmations) OR EXISTS(SELECT 1 FROM public.private_treasury_releases) THEN RAISE EXCEPTION 'fresh private Source tables required';END IF;
END;$$;
ALTER TABLE public.private_research_intents ALTER COLUMN created_at DROP DEFAULT;
ALTER TABLE public.private_research_intents ALTER COLUMN created_at TYPE text USING NULL::text;
ALTER TABLE public.private_research_intents ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE public.private_research_payment_attempts ALTER COLUMN started_at DROP DEFAULT;
ALTER TABLE public.private_research_payment_attempts ALTER COLUMN started_at TYPE text USING NULL::text;
ALTER TABLE public.private_research_payment_attempts ALTER COLUMN started_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE public.private_research_payment_attempts ALTER COLUMN settled_at DROP DEFAULT;
ALTER TABLE public.private_research_payment_attempts ALTER COLUMN settled_at TYPE text USING NULL::text;
ALTER TABLE public.private_research_executions ALTER COLUMN started_at DROP DEFAULT;
ALTER TABLE public.private_research_executions ALTER COLUMN started_at TYPE text USING NULL::text;
ALTER TABLE public.private_research_executions ALTER COLUMN started_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE public.private_research_results ALTER COLUMN saved_at DROP DEFAULT;
ALTER TABLE public.private_research_results ALTER COLUMN saved_at TYPE text USING NULL::text;
ALTER TABLE public.private_research_results ALTER COLUMN saved_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE public.private_research_interruptions ALTER COLUMN recorded_at DROP DEFAULT;
ALTER TABLE public.private_research_interruptions ALTER COLUMN recorded_at TYPE text USING NULL::text;
ALTER TABLE public.private_research_interruptions ALTER COLUMN recorded_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE public.private_creator_submissions ALTER COLUMN started_at DROP DEFAULT;
ALTER TABLE public.private_creator_submissions ALTER COLUMN started_at TYPE text USING NULL::text;
ALTER TABLE public.private_creator_submissions ALTER COLUMN started_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE public.private_creator_confirmations ALTER COLUMN settled_at DROP DEFAULT;
ALTER TABLE public.private_creator_confirmations ALTER COLUMN settled_at TYPE text USING NULL::text;
ALTER TABLE public.private_creator_confirmations ALTER COLUMN settled_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE public.private_treasury_releases ALTER COLUMN released_at DROP DEFAULT;
ALTER TABLE public.private_treasury_releases ALTER COLUMN released_at TYPE text USING NULL::text;
ALTER TABLE public.private_treasury_releases ALTER COLUMN released_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE public.private_research_intents ALTER COLUMN data DROP DEFAULT;
ALTER TABLE public.private_research_intents ALTER COLUMN data TYPE text USING NULL::text;
ALTER TABLE public.private_research_payment_attempts ALTER COLUMN confirmation DROP DEFAULT;
ALTER TABLE public.private_research_payment_attempts ALTER COLUMN confirmation TYPE text USING NULL::text;
ALTER TABLE public.private_creator_submissions ALTER COLUMN data DROP DEFAULT;
ALTER TABLE public.private_creator_submissions ALTER COLUMN data TYPE text USING NULL::text;
ALTER TABLE public.private_creator_confirmations ALTER COLUMN data DROP DEFAULT;
ALTER TABLE public.private_creator_confirmations ALTER COLUMN data TYPE text USING NULL::text;
ALTER TABLE public.private_research_results DROP CONSTRAINT private_research_results_serialized_run_check;

-- Source sqlite scalar clients are arbitrary TEXT; preserve their exact groups.
ALTER TABLE public.query_runs DROP CONSTRAINT query_runs_mcp_client_check;
-- SQLite keeps these observations as arbitrary TEXT; semantic consumers use
-- identity/SHA-bound Source scalars rather than an encoded shadow as authority.
ALTER TABLE public.query_runs DROP CONSTRAINT query_runs_origin_check;
ALTER TABLE public.query_runs DROP CONSTRAINT query_runs_payment_mode_check;
-- JSON.stringify cells retain escaped NUL/surrogates independently of scalars.
ALTER TABLE public.query_runs ALTER COLUMN economics_data TYPE json USING economics_data::json;
ALTER TABLE public.browser_journal_bindings ADD COLUMN payment_context text CHECK(payment_context IS NULL OR payment_context IS JSON);
ALTER TABLE public.browser_signing_namespaces ADD COLUMN proof text NOT NULL CHECK(proof IS JSON);
ALTER TABLE public.browser_signing_queries ADD COLUMN grant_epoch text NOT NULL;
ALTER TABLE public.browser_signing_queries ADD COLUMN proof text NOT NULL CHECK(proof IS JSON);
ALTER TABLE public.browser_signing_queries ADD COLUMN proof_digest text NOT NULL;
ALTER TABLE public.browser_signing_v2_barrier ADD COLUMN ever_active keryx_storage.sqlite_number NOT NULL DEFAULT 0 CHECK(ever_active IN(0,1));
ALTER TABLE public.source_items ADD COLUMN evidence_provenance text;
-- SQLite retains historical items without a current sources row. The original
-- Supabase cascade is not SQLite authority: importing must neither invent a
-- payout source nor delete retained item originals. Paid delivery still loads
-- the current source and registry terms independently before item delivery.
ALTER TABLE public.source_items DROP CONSTRAINT source_items_source_id_fkey;
ALTER TABLE public.sources ADD COLUMN preview_depth text;
ALTER TABLE public.sources ADD COLUMN evidence_provenance text;

CREATE FUNCTION keryx_storage.mainnet_binding_retention() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.nonce IS DISTINCT FROM OLD.nonce OR NEW.requirements IS DISTINCT FROM OLD.requirements
  OR NEW.payment_metadata IS DISTINCT FROM OLD.payment_metadata
  OR (OLD.payment_context IS NOT NULL AND NEW.payment_context IS DISTINCT FROM OLD.payment_context)
  OR (NEW.payment_context IS DISTINCT FROM OLD.payment_context AND NOT EXISTS(SELECT 1 FROM public.payment_events WHERE id='x402:'||OLD.nonce AND authorization_phase='prepared'))
 THEN RAISE EXCEPTION 'original mainnet challenge immutable';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER mainnet_binding_retention BEFORE UPDATE ON public.browser_journal_bindings FOR EACH ROW EXECUTE FUNCTION keryx_storage.mainnet_binding_retention();
REVOKE ALL ON FUNCTION keryx_storage.mainnet_binding_retention() FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
