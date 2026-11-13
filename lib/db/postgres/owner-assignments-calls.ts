/** Closed recipient operations. Owner execution is deliberately absent. */
export const OWNER_ASSIGNMENT_CALLS=Object.freeze({
 ownerAssignmentAct:{sql:'SELECT public.storage_owner_assignment_act($1::jsonb,$2::text,$3::jsonb,$4::jsonb,$5::jsonb,$6::text) AS result',args:4,write:true,bytes:16384},
 ownerAssignmentReply:{sql:'SELECT public.storage_owner_assignment_reply($1::jsonb,$2::text,$3::jsonb,$4::text,$5::text,$6::jsonb,$7::jsonb) AS result',args:5,write:false,bytes:2097152,transaction:true},
} as const);
