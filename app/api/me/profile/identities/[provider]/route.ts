import { identityRoutes } from "@/lib/profiles/identity-route-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request, context: { params: Promise<{ provider: string }> }) {
  return identityRoutes.DELETE(request, (await context.params).provider);
}
