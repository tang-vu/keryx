import { accountSessionContext, sessionMutationOrigin } from "@/lib/account-sessions";
import { authJson } from "@/lib/auth-challenge";

export const runtime = "nodejs";

export async function GET() {
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  try {
    const rows = await context.db.listWebSessions(context.wallet, Date.now());
    return authJson({ sessions: rows.slice(0, 100).map(row => ({ id: row.hash, issuedAt: row.issuedAt, expiresAt: row.expiresAt, current: row.hash === context.currentId })), truncated: rows.length > 100 });
  } catch { return authJson({ error: "Sessions could not be loaded. Please retry." }, 503); }
}

/** One owner-scoped database statement; the current session and other wallets survive. */
export async function DELETE(req: Request) {
  const originError = sessionMutationOrigin(req); if (originError) return originError;
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  try {
    await context.db.revokeOtherWebSessions(context.wallet, context.currentId);
    if ((await context.db.listWebSessions(context.wallet, Date.now())).some(row => row.hash !== context.currentId)) {
      return authJson({ error: "Sign-out could not be confirmed. Refresh and retry." }, 503);
    }
    return authJson({ ok: true });
  } catch { return authJson({ error: "Sign-out could not be confirmed. Refresh and retry." }, 503); }
}
