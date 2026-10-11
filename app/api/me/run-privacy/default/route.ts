import { privacyDefaults } from "@/lib/run-privacy/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const GET=(request:Request)=>privacyDefaults(request);
export const PATCH=(request:Request)=>privacyDefaults(request,true);
