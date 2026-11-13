/** Fixed observation calls; no caller-selected function, table or SQL. */
export const HEALTH_CALLS=Object.freeze({
 syncStateBatch:{sql:'SELECT public.storage_sync_state_batch($1::jsonb,$2::text,$3::jsonb) AS result',args:1,write:false,bytes:8454144,transaction:true},
 publicHealthSnapshot:{sql:'SELECT public.storage_public_health_snapshot($1::jsonb,$2::text,$3::text,$4::boolean) AS result',args:2,write:false,bytes:12648448,transaction:true},
 currentJobSnapshot:{sql:'SELECT public.storage_current_job_snapshot($1::jsonb,$2::text,$3::text) AS result',args:1,write:false,bytes:4198400,transaction:true},
} as const);
