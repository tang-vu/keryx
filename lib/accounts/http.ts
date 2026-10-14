import { z, ZodError } from "zod";
import { AccountError, accountConsentSchema, digestSchema, linkConsentSchema, preconditionSchema, walletInputSchema,
  type InteractiveSession } from "./contracts";
import type { createAccountMembershipService } from "./service";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare-create"), consent: accountConsentSchema }).strict(),
  z.object({ action: z.literal("complete-create"), nonce: digestSchema, consent: z.unknown() }).strict(),
  z.object({ action: z.literal("resume"), expected: preconditionSchema, consent: accountConsentSchema }).strict(),
  z.object({ action: z.literal("prepare-link"), expected: preconditionSchema, wallet: walletInputSchema, consent: linkConsentSchema }).strict(),
  z.object({ action: z.literal("complete-link"), nonce: digestSchema, signature: z.unknown(), consent: z.unknown() }).strict(),
  z.object({ action: z.literal("unlink"), expected: preconditionSchema, wallet: walletInputSchema, generation: digestSchema, consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("revoke-session"), expected: preconditionSchema, consent: z.literal(true) }).strict(),
]);
type Service = ReturnType<typeof createAccountMembershipService>;
export interface AccountRequestAuthority { service: Service; session: InteractiveSession }
interface AccountRouteDependencies {
  /** Fixed configured origin, not the request Host header. */
  origin: string;
  /** Authenticated JWT + exact durable row + actual ordinary capability.
   * No bearer fallback, provider label, wallet-only stub or storage selector. */
  authenticate(request: Request): Promise<AccountRequestAuthority | Response>;
}
export function accountJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie, Authorization", "X-Content-Type-Options": "nosniff" } });
}
export const accountUnavailable = () => accountJson({ error: "account_unavailable", message: "Private account membership is unavailable on this deployment." }, 503);

async function body(request: Request) {
  if (!request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new AccountError("invalid_account_request");
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new AccountError("invalid_account_request")); void reader.cancel().catch(() => undefined); }, 5000); });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]); if (part.done) break;
      size += part.value.byteLength; if (size > 12_288 || request.signal.aborted) throw new AccountError("invalid_account_request"); chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return requestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
function failure(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError) return accountJson({ error: "invalid_account_request" }, 400);
  if (!(error instanceof AccountError)) return accountUnavailable();
  const status = error.code === "account_unavailable" ? 503 : error.code === "account_unauthenticated" ? 401
    : error.code === "invalid_account_request" || error.code === "invalid_membership_proof" ? 400 : 409;
  return accountJson({ error: error.code }, status);
}

export function createAccountMembershipRoutes(deps: AccountRouteDependencies) {
  async function execute(request: Request, write: boolean) {
    try {
      if (request.headers.has("authorization")) return accountJson({ error: "interactive_account_session_required" }, 401);
      const url = new URL(request.url);
      if (url.origin !== deps.origin || url.search || request.signal.aborted) return accountJson({ error: "invalid_account_request" }, 400);
      if (write && request.headers.get("origin") !== deps.origin) return accountJson({ error: "same_origin_required" }, 403);
      const input = write ? await body(request) : null;
      const auth = await deps.authenticate(request);
      if (auth instanceof Response) return auth;
      const { service, session } = auth;
      if (write) {
        const expectedWallet = request.headers.get("x-keryx-expected-wallet");
        if (expectedWallet === null) return accountJson({ error: "wallet_precondition_required" }, 428);
        const parsed = walletInputSchema.safeParse(expectedWallet);
        if (!parsed.success) return accountJson({ error: "invalid_account_request" }, 400);
        if (parsed.data !== session.wallet) return accountJson({ error: "account_changed" }, 409);
      }
      if (!input) {
        const start = await service.resolve(session);
        const offer = start ? { accountId: start.membership.accountId, revision: start.membership.revision } : await service.offer(session);
        const end = await service.resolve(session);
        const finalOffer = end ? { accountId: end.membership.accountId, revision: end.membership.revision } : await service.offer(session);
        if (JSON.stringify(start) !== JSON.stringify(end) || JSON.stringify(offer) !== JSON.stringify(finalOffer) || request.signal.aborted) throw new AccountError("account_changed");
        return accountJson({ version: 1, wallet: session.wallet, membership: end?.membership ?? null, offer });
      }
      switch (input.action) {
        case "prepare-create": return accountJson(await service.prepareCreate(session, input.consent));
        case "complete-create": return accountJson({ membership: (await service.completeCreate(session, input.nonce, input.consent)).membership });
        case "resume": return accountJson({ membership: (await service.resume(session, input.expected, input.consent)).membership });
        case "prepare-link": return accountJson(await service.prepareLink(session, input.wallet, input.expected, input.consent));
        case "complete-link": return accountJson({ membership: (await service.completeLink(session, input.nonce, input.signature, input.consent)).membership });
        case "unlink": return accountJson({ membership: await service.unlink(session, input.expected, input.wallet, input.generation, input.consent) });
        case "revoke-session": await service.revokeSession(session, input.expected); return accountJson({ revoked: true });
      }
    } catch (error) { return failure(error); }
  }
  return { GET: (request: Request) => execute(request, false), POST: (request: Request) => execute(request, true) };
}
