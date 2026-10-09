import { identityRoutes } from "@/lib/profiles/identity-route-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  return identityRoutes.START(request, (await context.params).provider);
}
