export const PUBLIC_LEDGER_CALLS=Object.freeze({
 publicLedgerRead:{sql:'SELECT public.storage_public_ledger_read($1::jsonb,$2::text,$3::integer) AS result',args:1,write:false,bytes:41943040,inputBytes:65536,transaction:true},
} as const);
