import { identityRoutes } from "@/lib/profiles/identity-route-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  return identityRoutes.CALLBACK(request, (await context.params).provider);
}
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  return identityRoutes.CALLBACK_POST(request, (await context.params).provider);
}
