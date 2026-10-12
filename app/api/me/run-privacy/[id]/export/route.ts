import { privacyRun } from "@/lib/run-privacy/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const GET=async(request:Request,context:{params:Promise<{id:string}>})=>privacyRun(request,(await context.params).id,"export");
