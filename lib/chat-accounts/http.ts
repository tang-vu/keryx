import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { isConfiguredSameOrigin } from "../auth-origin";
import { bindingSchema, interactiveSessionSchema, type AccountBinding, type AccountSnapshot } from "../accounts/contracts";
import { ChatAccountError, completionSchema, recipientSchema } from "./contracts";
import { assertChatConsentProof, chatConsentProof, chatAccountPort, chatTokenHash } from "./service";

export function chatJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Origin" } });
}
interface Context { db: KeryxDB; wallet: string; currentId: string }
interface Dependencies { binding: AccountBinding; session(): Promise<Context | Response> }
export function createChatAccountRoutes(deps: Dependencies) {
  async function authority(req: Request): Promise<{ context: Context; snapshot: AccountSnapshot } | Response> {
    if (req.headers.has("authorization")) return chatJson({ error: "interactive_session_required" }, 401);
    if (!bindingSchema.safeParse(deps.binding).success) return chatJson({ error: "chat_unavailable" }, 503);
    const url = new URL(req.url);
    if (url.origin !== deps.binding.origin || url.search || url.hash) return chatJson({ error: "invalid_chat_request" }, 400);
    if (req.method !== "GET" && !isConfiguredSameOrigin(req, deps.binding.origin)
      || req.method === "GET" && req.headers.has("origin") && !isConfiguredSameOrigin(req, deps.binding.origin))
      return chatJson({ error: "same_origin_required" }, 403);
    const context = await deps.session();
    if (context instanceof Response) return context;
    const row = await context.db.getWebSession(context.currentId);
    if (!row || row.hash !== context.currentId || row.wallet !== context.wallet) return chatJson({ error: "interactive_session_required" }, 401);
    const session = interactiveSessionSchema.parse({ sessionHash: row.hash, wallet: row.wallet, issuedAt: row.issuedAt, expiresAt: row.expiresAt });
    const descriptor = Object.getOwnPropertyDescriptor(context.db, "accountMembership");
    if (!descriptor || descriptor.enumerable || !("value" in descriptor) || !chatAccountPort(context.db)) return chatJson({ error: "chat_unavailable" }, 503);
    const snapshot = await context.db.accountMembership?.resolve(session, deps.binding);
    if (!snapshot) return chatJson({ error: "explicit_account_membership_required" }, 409);
    if (req.signal.aborted) return chatJson({ error: "invalid_chat_request" }, 400);
    return { context, snapshot };
  }
  async function body(req: Request): Promise<unknown> {
    if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ChatAccountError("chat_invalid_command");
    const reader = req.body?.getReader();
    if (!reader) throw new ChatAccountError("chat_invalid_command");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 4096) { await reader.cancel(); throw new ChatAccountError("chat_invalid_command"); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  async function handle(req: Request, completion: boolean): Promise<Response> {
    try {
      const allowed = completion ? ["POST"] : ["GET", "POST"];
      if (!allowed.includes(req.method)) return chatJson({ error: "method_not_allowed" }, 405);
      const url = new URL(req.url);
      if (url.pathname !== (completion ? "/api/me/chat-accounts/complete" : "/api/me/chat-accounts")) return chatJson({ error: "invalid_chat_request" }, 400);
      const auth = await authority(req); if (auth instanceof Response) return auth;
      const { context, snapshot } = auth, port = chatAccountPort(context.db)!;
      if (req.method === "GET") {
        const links = await port.list(snapshot);
        return chatJson({ account: { accountId: snapshot.membership.accountId, revision: snapshot.membership.revision },
          links: links.map(({ platform, scope, userId, channel, linkedAt }) => ({ platform, scope, userId, channel, linkedAt })),
          pastRuns: { status: "unavailable", reason: "No verified retained chat-user provenance exists for historical runs." } });
      }
      const raw = await body(req);
      if (completion) {
        if (raw && typeof raw === "object" && "pastRunIds" in raw && Array.isArray(raw.pastRunIds) && raw.pastRunIds.length)
          return chatJson({ error: "chat_past_runs_unavailable" }, 409);
        const parsed = completionSchema.safeParse(raw);
        if (!parsed.success) return chatJson({ error: "invalid_chat_consent" }, 400);
        const value = parsed.data;
        if (snapshot.membership.accountId !== value.accountId || snapshot.membership.revision !== value.revision)
          return chatJson({ error: "chat_account_changed" }, 409);
        assertChatConsentProof(value.consentProof, chatTokenHash(value.token), snapshot);
        if (req.signal.aborted) return chatJson({ error: "invalid_chat_request" }, 400);
        const link = await port.complete(chatTokenHash(value.token), snapshot);
        return chatJson({ linked: true, platform: link.platform, pastRuns: { status: "unavailable" } });
      }
      const input = z.discriminatedUnion("action", [
        z.object({ action: z.literal("preview"), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
        z.object({ action: z.literal("unlink"), recipient: recipientSchema, accountId: z.string(), revision: z.number().int() }).strict(),
      ]).safeParse(raw);
      if (!input.success) return chatJson({ error: "invalid_chat_request" }, 400);
      if (input.data.action === "preview") {
        const pending = await port.preview(chatTokenHash(input.data.token), deps.binding);
        await context.db.accountMembership!.assertCurrent(snapshot);
        return chatJson({ recipient: pending.recipient, expiresAt: pending.expiresAt,
          consentProof: chatConsentProof(chatTokenHash(input.data.token), snapshot, pending.expiresAt),
          account: { accountId: snapshot.membership.accountId, revision: snapshot.membership.revision }, pastRuns: { status: "unavailable" } });
      }
      if (input.data.accountId !== snapshot.membership.accountId || input.data.revision !== snapshot.membership.revision)
        return chatJson({ error: "chat_account_changed" }, 409);
      if (req.signal.aborted) return chatJson({ error: "invalid_chat_request" }, 400);
      await port.unlinkAccount(input.data.recipient, snapshot);
      return chatJson({ unlinked: true });
    } catch (error) {
      const code = error instanceof ChatAccountError ? error.code : "chat_unavailable";
      return chatJson({ error: code }, code === "chat_takeover_refused" || code === "chat_account_changed" ? 409 : code === "chat_token_invalid" ? 410 : 503);
    }
  }
  return Object.freeze({ account: (req: Request) => handle(req, false), complete: (req: Request) => handle(req, true) });
}
