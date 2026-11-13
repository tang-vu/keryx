/** Fixed actions only. Recipient, snapshot and hashes are data, never SQL. */
export const CHAT_LINK_CALLS=Object.freeze({
 chatPreview:{sql:"SELECT public.storage_chat_observe($1::jsonb,$2::text,'preview',$3::jsonb) AS result",args:1,write:false,bytes:32768,transaction:true},
 chatLookup:{sql:"SELECT public.storage_chat_observe($1::jsonb,$2::text,'lookup',$3::jsonb) AS result",args:1,write:false,bytes:32768,transaction:true},
 chatList:{sql:"SELECT public.storage_chat_observe($1::jsonb,$2::text,'list',$3::jsonb) AS result",args:1,write:false,bytes:131072,transaction:true},
 chatIssue:{sql:"SELECT public.storage_chat_write($1::jsonb,$2::text,'issue',$3::jsonb) AS result",args:1,write:true,bytes:32768},
 chatComplete:{sql:"SELECT public.storage_chat_write($1::jsonb,$2::text,'complete',$3::jsonb) AS result",args:1,write:true,bytes:32768},
 chatUnlink:{sql:"SELECT public.storage_chat_write($1::jsonb,$2::text,'unlink',$3::jsonb) AS result",args:1,write:true,bytes:32768},
 chatUnlinkAccount:{sql:"SELECT public.storage_chat_write($1::jsonb,$2::text,'unlink_account',$3::jsonb) AS result",args:1,write:true,bytes:32768},
} as const);
