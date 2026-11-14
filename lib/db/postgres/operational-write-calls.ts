/** Source-owned operational writes; identity/rate limits grant no payment authority. */
export const OPERATIONAL_WRITE_CALLS=Object.freeze({
  operational_consume_rate_limit:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'consume_rate_limit',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  operational_delete_expired_rate_limits:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'delete_expired_rate_limits',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  operational_acquire_reasoning_circuit:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'acquire_reasoning_circuit',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  operational_record_reasoning_circuit_failure:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'record_reasoning_circuit_failure',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  operational_clear_reasoning_circuit:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'clear_reasoning_circuit',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  operational_mint_api_key:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'mint_api_key',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  operational_verify_api_key_2:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'verify_api_key_2',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  operational_revoke_api_key:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'revoke_api_key',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  operational_upsert_api_key_usage:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'upsert_api_key_usage',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  operational_record_feedback:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'record_feedback',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  operational_increment_activation_event:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'increment_activation_event',$3::jsonb) AS result",args:1,write:true,bytes:4194304},
} as const);
export const OPERATIONAL_WRITE_OPERATIONS=Object.freeze({
  consume_rate_limit:"operational_consume_rate_limit",
  delete_expired_rate_limits:"operational_delete_expired_rate_limits",
  acquire_reasoning_circuit:"operational_acquire_reasoning_circuit",
  record_reasoning_circuit_failure:"operational_record_reasoning_circuit_failure",
  clear_reasoning_circuit:"operational_clear_reasoning_circuit",
  mint_api_key:"operational_mint_api_key",
  verify_api_key_2:"operational_verify_api_key_2",
  revoke_api_key:"operational_revoke_api_key",
  upsert_api_key_usage:"operational_upsert_api_key_usage",
  record_feedback:"operational_record_feedback",
  increment_activation_event:"operational_increment_activation_event",
} as const);
