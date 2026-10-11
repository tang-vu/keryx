import { privacyRun } from "@/lib/run-privacy/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export const GET=async(request:Request,context:Context)=>privacyRun(request,(await context.params).id,"owner");
export const PATCH=async(request:Request,context:Context)=>privacyRun(request,(await context.params).id,"visibility");
export const DELETE=async(request:Request,context:Context)=>privacyRun(request,(await context.params).id,"erase");
