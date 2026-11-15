/** Fixed Source names; no SQL, callback or financial authority supplied by callers. */
export const PRIVATE_RESEARCH_CALLS=Object.freeze({
 privateResearchSnapshot:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'snapshot',$3::text,$4::text) AS result",args:2,write:false,transaction:true,bytes:134225920},
 privateResearchHistory:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'history',$3::text,$4::text) AS result",args:2,write:false,transaction:true,bytes:134225920},
 privateResearchSummary:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'summary',$3::text,$4::text) AS result",args:2,write:false,transaction:true,bytes:134225920},
 privateResearchWorkers:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'workers',$3::text,$4::text) AS result",args:2,write:false,transaction:true,bytes:134225920},
 privateResearchReconciliation:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'reconciliation',$3::text,$4::text) AS result",args:2,write:false,transaction:true,bytes:134225920},
 privateResearchReserveIntent:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'reserve-intent',$3::text,$4::text) AS result",args:2,write:true,bytes:134225920,inputBytes:134225920},
 privateResearchReserveTreasury:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'reserve-treasury',$3::text,$4::text) AS result",args:2,write:true,bytes:134225920,inputBytes:134225920},
 privateResearchClaimPayment:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'claim-payment',$3::text,$4::text) AS result",args:2,write:true,bytes:134225920,inputBytes:134225920},
 privateResearchConfirmPayment:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'confirm-payment',$3::text,$4::text) AS result",args:2,write:true,bytes:134225920,inputBytes:134225920},
 privateResearchClaimExecution:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'claim-execution',$3::text,$4::text) AS result",args:2,write:true,bytes:134225920,inputBytes:134225920},
 privateResearchAdmitCreator:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'admit-creator',$3::text,$4::text) AS result",args:2,write:true,bytes:134225920,inputBytes:134225920},
 privateResearchConfirmCreator:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'confirm-creator',$3::text,$4::text) AS result",args:2,write:true,bytes:134225920,inputBytes:134225920},
 privateResearchSaveResult:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'save-result',$3::text,$4::text) AS result",args:2,write:true,bytes:134225920,inputBytes:134225920},
 privateResearchInterrupt:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'interrupt',$3::text,$4::text) AS result",args:2,write:true,bytes:134225920,inputBytes:134225920},
 privateResearchRelease:{sql:"SELECT public.storage_private_research($1::jsonb,$2::text,'release',$3::text,$4::text) AS result",args:2,write:true,bytes:134225920,inputBytes:134225920},
} as const);
