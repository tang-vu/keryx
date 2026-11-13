/** Fixed native review statements. Callers cannot supply an action or SQL. */
export const REVIEW_CALLS=Object.freeze({
 reviewReady:{sql:"SELECT public.storage_review_read($1::jsonb,$2::text,'ready',$3::text,$4::text) AS result",args:2,write:false,bytes:256,transaction:true},
 reviewRead:{sql:"SELECT public.storage_review_read($1::jsonb,$2::text,'read',$3::text,$4::text) AS result",args:2,write:false,bytes:32768,transaction:true},
 reviewList:{sql:"SELECT public.storage_review_read($1::jsonb,$2::text,'list',$3::text,$4::text) AS result",args:2,write:false,bytes:6299648,transaction:true},
 reviewMetrics:{sql:"SELECT public.storage_review_read($1::jsonb,$2::text,'metrics',$3::text,$4::text) AS result",args:2,write:false,bytes:1049600,transaction:true},
 reviewCapture:{sql:"SELECT public.storage_review_mutation($1::jsonb,$2::text,'capture',$3::text,$4::text) AS result",args:2,write:true,bytes:32768,inputBytes:131072},
 reviewBegin:{sql:"SELECT public.storage_review_mutation($1::jsonb,$2::text,'begin',$3::text,$4::text) AS result",args:2,write:true,bytes:32768},
 reviewVerdict:{sql:"SELECT public.storage_review_mutation($1::jsonb,$2::text,'verdict',$3::text,$4::text) AS result",args:2,write:true,bytes:32768,inputBytes:131072},
 reviewConsume:{sql:"SELECT public.storage_review_mutation($1::jsonb,$2::text,'consume',$3::text,$4::text) AS result",args:2,write:true,bytes:32768},
 reviewCancel:{sql:"SELECT public.storage_review_mutation($1::jsonb,$2::text,'cancel',$3::text,$4::text) AS result",args:2,write:true,bytes:256},
 reviewExpire:{sql:"SELECT public.storage_review_mutation($1::jsonb,$2::text,'expire',$3::text,$4::text) AS result",args:2,write:true,bytes:256},
 reviewObserve:{sql:"SELECT public.storage_review_mutation($1::jsonb,$2::text,'observe',$3::text,$4::text) AS result",args:2,write:true,bytes:256},
} as const);
