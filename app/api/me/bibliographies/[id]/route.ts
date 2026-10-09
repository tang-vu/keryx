import { accountSessionContext } from "@/lib/account-sessions";
import { createBibliographyManagement } from "@/lib/bibliographies/bibliography-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes = createBibliographyManagement(accountSessionContext);
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) { return routes.replace(req, (await context.params).id); }
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) { return routes.revoke(req, (await context.params).id); }
