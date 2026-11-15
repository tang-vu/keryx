/** Fixed Source protocols only; these descriptors confer no facade provenance. */
export const OPERATOR_WITHDRAWAL_CALLS=Object.freeze({
 operatorSourceInventory:{sql:"SELECT public.storage_application_read_group_8($1::jsonb,$2::text,'operator_source_inventory',$3::jsonb) AS result",args:1,write:false,transaction:true,bytes:4194304},
 operatorSourcePublic:{sql:"SELECT public.storage_application_read_group_8($1::jsonb,$2::text,'operator_source_public',$3::jsonb) AS result",args:1,write:false,transaction:true,bytes:4194304},
 withdrawalSourceRecord:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'record_withdrawal',$3::jsonb) AS result",args:1,write:true,bytes:128},
} as const);
