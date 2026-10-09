import { ZodError } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { parseScopes } from "../api-key-scopes";
import { isConfiguredSameOrigin } from "../auth-origin";
import { AcceptanceError, acceptanceInputSchema, acceptanceWallet, deliverableIdSchema, requireDeliverableAcceptance } from "./contracts";

interface Dependencies {
  session(): Promise<{ db: KeryxDB; wallet: string; currentId: string } | Response>;
  key(raw: string): Promise<{ walletAddress: string; keyId: string; scopes: string | null } | null>;
  db(): Promise<KeryxDB>; network: string; baseUrl: string;
}
export function acceptanceJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
}
async function body(req: Request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get("content-type") ?? "") || !req.body) throw new ZodError([]);
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new ZodError([])); void reader.cancel().catch(() => {}); }, 10000); });
  try {
    for (;;) { const { done, value } = await Promise.race([reader.read(), deadline]); if (done) break;
      bytes += value.length; if (bytes > 16384) throw new ZodError([]); chunks.push(value); }
    const all = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    return acceptanceInputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all)));
  } catch { throw new ZodError([]); } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
/** Presence of Authorization selects only explicit owner-key authority. Origin is server-configured. */
export function createAcceptanceRoute(deps: Dependencies, write: boolean) {
  return async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    try {
      const header = req.headers.get("authorization"); let context;
      if (header !== null) {
        if (!/^Bearer kx_live_[0-9a-f]{96}$/.test(header)) return acceptanceJson({ error: "unauthenticated" }, 401);
        const key = await deps.key(header.slice(7)); if (!key) return acceptanceJson({ error: "unauthenticated" }, 401);
        if (!parseScopes(key.scopes).includes(write ? "deliverable:write" : "deliverable:read")) return acceptanceJson({ error: "insufficient_scope" }, 403);
        context = { wallet: acceptanceWallet(key.walletAddress), db: await deps.db(), authority: { kind: "api-key" as const, id: key.keyId } };
      } else {
        if (write && !isConfiguredSameOrigin(req, deps.baseUrl)) return acceptanceJson({ error: "same_origin_required" }, 403);
        if (req.headers.get("x-keryx-expected-wallet") === null) return acceptanceJson({ error: "expected_wallet_required" }, 428);
        const session = await deps.session(); if (session instanceof Response) return acceptanceJson({ error: session.status === 401 ? "unauthenticated" : "acceptance_unavailable" }, session.status);
        context = { ...session, authority: { kind: "session" as const, id: session.currentId } };
      }
      const expected = req.headers.get("x-keryx-expected-wallet");
      if (expected !== null && (!/^0x[0-9a-fA-F]{40}$/.test(expected) || expected.toLowerCase() !== acceptanceWallet(context.wallet)))
        return acceptanceJson({ error: "acceptance_owner_changed" }, 409);
      const url = new URL(req.url); if (url.search) return acceptanceJson({ error: "invalid_acceptance_request" }, 400);
      const id = deliverableIdSchema.parse((await ctx.params).id), store = requireDeliverableAcceptance(context.db);
      const result = write ? await store.submit(context.wallet, deps.network, id, await body(req), context.authority)
        : await store.read(context.wallet, deps.network, id);
      return acceptanceJson(result);
    } catch (error) {
      if (error instanceof ZodError) return acceptanceJson({ error: "invalid_acceptance_request" }, 400);
      if (error instanceof AcceptanceError && error.code === "acceptance_conflict") return acceptanceJson({ error: error.code }, 409);
      if (error instanceof AcceptanceError && error.code === "acceptance_unauthenticated") return acceptanceJson({ error: "unauthenticated" }, 401);
      return acceptanceJson({ error: "acceptance_unavailable" }, 503);
    }
  };
}
