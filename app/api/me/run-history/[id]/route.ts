import { runClaimHttp } from "@/lib/run-claims/http-runtime";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return runClaimHttp.DETAIL(request, (await context.params).id);
}
