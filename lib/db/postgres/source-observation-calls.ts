/** Closed Source observations only; no SQL/selector callback escapes. */
export const SOURCE_OBSERVATION_CALLS=Object.freeze({
 sourceEvidenceProvenanceRead:{sql:"SELECT public.storage_hosted_admit_authorization($1::jsonb,$2::text,'source-evidence-provenance',NULL,$3::text,NULL,NULL,NULL) AS result",args:1,write:false,transaction:true,inputBytes:1544192,bytes:2359296},
 sourceVerifyIfUnchanged:{sql:"SELECT public.storage_source_item_by_link($1::jsonb,$2::text,NULL,$3::text) AS result",args:1,write:true,inputBytes:26624,bytes:128},
} as const);
