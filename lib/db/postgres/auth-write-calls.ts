/** Qualified native web-auth operations only; no caller SQL or paid authority. */
export const AUTH_WRITE_CALLS=Object.freeze({
  auth_create_auth_challenge:{sql:"SELECT public.storage_application_create_auth_challenge($1::jsonb,$2::text,$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  auth_consume_auth_challenge:{sql:"SELECT public.storage_application_consume_auth_challenge($1::jsonb,$2::text,$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  auth_create_web_session:{sql:"SELECT public.storage_application_create_web_session($1::jsonb,$2::text,$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  auth_revoke_web_session:{sql:"SELECT public.storage_application_revoke_web_session($1::jsonb,$2::text,$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  auth_revoke_other_web_sessions:{sql:"SELECT public.storage_application_revoke_other_web_sessions($1::jsonb,$2::text,$3::jsonb) AS result",args:1,write:true,bytes:4194304},
  auth_upsert_user:{sql:"SELECT public.storage_application_upsert_user($1::jsonb,$2::text,$3::jsonb) AS result",args:1,write:true,bytes:4194304},
} as const);
export const AUTH_WRITE_OPERATIONS=Object.freeze({
  create_auth_challenge:"auth_create_auth_challenge",
  consume_auth_challenge:"auth_consume_auth_challenge",
  create_web_session:"auth_create_web_session",
  revoke_web_session:"auth_revoke_web_session",
  revoke_other_web_sessions:"auth_revoke_other_web_sessions",
  upsert_user:"auth_upsert_user",
} as const);
