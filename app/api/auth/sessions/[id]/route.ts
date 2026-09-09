import { accountSessionContext, sessionMutationOrigin } from "@/lib/account-sessions";
import { authJson } from "@/lib/auth-challenge";

export const runtime = "nodejs";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sessionMutationOrigin(req); if (originError) return originError;
  const { id } = await params;
  if (!/^[a-f0-9]{64}$/.test(id)) return authJson({ error: "Invalid session." }, 400);
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  if (id === context.currentId) return authJson({ error: "Use Sign out to end this browser session." }, 409);
  try {
    // Idempotent and non-enumerating: another wallet's selector grants no authority.
    await context.db.revokeWebSession(id, context.wallet);
    const remaining = await context.db.getWebSession(id);
    if (remaining?.wallet === context.wallet) return authJson({ error: "Sign-out could not be confirmed. Refresh and retry." }, 503);
    return authJson({ ok: true });
  } catch { return authJson({ error: "Sign-out could not be confirmed. Refresh and retry." }, 503); }
}
