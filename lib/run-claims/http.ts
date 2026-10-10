import { createHash } from "node:crypto";
import { z, ZodError } from "zod";
import { parseScopes } from "../api-key-scopes";
import type { KeryxDB } from "../db/keryx-db";
import { HistoryError, parseHistoryQuery } from "../history/personal-history";
import { clientIp } from "../rate-limit";
import { claimRun } from "./service";
import { requireRunClaims, RunClaimError, runClaimBindingSchema, runClaimIdSchema, runClaimWalletSchema, type RunClaimBinding } from "./contracts";
import { ownershipHistoryOriginal, readRunOwnershipHistory, requireRunOwnershipHistory, runOwnershipSchema } from "./history";
import { privateRunResponse } from "./private-response";

interface Context { db: KeryxDB; wallet: string; currentId: string }
interface Dependencies {
  enabled: boolean;
  binding: RunClaimBinding | null;
  session(): Promise<Context | Response>;
  key(raw: string): Promise<{ walletAddress: string; scopes: string | null } | null>;
  db(): Promise<KeryxDB>;
  now?: () => number;
}
const json = (value: unknown, status = 200) => privateRunResponse(Response.json(value, { status }));
const unavailable = () => json({ error: "claim_unavailable" }, 404);
const bodySchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
async function claimBody(request: Request) {
  if (!request.body || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new Error("Invalid body");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error("Body deadline")); void reader.cancel().catch(() => undefined); }, 5000); });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break;
      length += value.length; if (length > 256) throw new Error("Body too large"); chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bodySchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } finally { clearTimeout(timer); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** This boundary never derives authority from request URLs/Host, body wallets or a bearer key.
 * Durable counters precede body/token parsing; the store rechecks the same SIWE session atomically. */
export function createRunClaimRoutes(deps: Dependencies) {
  const binding = runClaimBindingSchema.safeParse(deps.binding);
  const available = deps.enabled && binding.success;
  const now = deps.now ?? Date.now;
  const authenticate = async (request: Request, write: boolean) => {
    const expected = request.headers.get("x-keryx-expected-wallet");
    if (expected !== null && !runClaimWalletSchema.safeParse(expected).success) return json({ error: "invalid_owner_precondition" }, 400);
    const header = request.headers.get("authorization");
    if (write) {
      if (header !== null) return json({ error: "interactive_session_required" }, 403);
      if (!binding.success || request.headers.get("origin") !== binding.data.origin || request.headers.get("sec-fetch-site") === "cross-site")
        return json({ error: "same_origin_required" }, 403);
      if (expected === null) return json({ error: "owner_precondition_required" }, 428);
    }
    let context: { db: KeryxDB; wallet: string; currentId?: string } | Response;
    if (header !== null) {
      if (!/^Bearer kx_live_[0-9a-f]{96}$/.test(header)) return json({ error: "unauthenticated" }, 401);
      const key = await deps.key(header.slice(7));
      if (!key) return json({ error: "unauthenticated" }, 401);
      if (!parseScopes(key.scopes).includes("history:read")) return json({ error: "insufficient_scope" }, 403);
      context = { db: await deps.db(), wallet: key.walletAddress };
    } else context = await deps.session();
    if (context instanceof Response) return privateRunResponse(context);
    const wallet = runClaimWalletSchema.parse(context.wallet);
    if (expected !== null && expected.toLowerCase() !== wallet) return json({ error: "owner_changed" }, 409);
    return { ...context, wallet };
  };
  return {
    async POST(request: Request): Promise<Response> {
      if (!available || !binding.success) return json({ error: "claims_unavailable" }, 503);
      try {
        if (new URL(request.url).search) return unavailable();
        const context = await authenticate(request, true); if (context instanceof Response) return context;
        if (!context.currentId || !/^[a-f0-9]{64}$/.test(context.currentId)) return json({ error: "unauthenticated" }, 401);
        // Read-only domain admission precedes even rate-counter writes. Sealed or
        // unenrolled adapters cannot gain a claim path by setting the HTTP flag.
        await requireRunClaims(context.db).assertAvailable();
        const ip = createHash("sha256").update(`keryx-run-claim-ip-v1:${clientIp(request).slice(0, 2048)}`).digest("hex");
        const stamp = now();
        const walletLimit = await context.db.consumeRateLimit(`run-claim-wallet:${context.wallet}`, 5, 60000, stamp);
        const ipLimit = await context.db.consumeRateLimit(`run-claim-ip:${ip}`, 20, 60000, stamp);
        if (!walletLimit.allowed || !ipLimit.allowed) {
          const seconds = Math.max(1, Math.ceil(Math.max(walletLimit.msBeforeNext, ipLimit.msBeforeNext) / 1000));
          const response = json({ error: "claim_rate_limited" }, 429); response.headers.set("Retry-After", String(seconds)); return response;
        }
        let body; try { body = await claimBody(request); } catch { return unavailable(); }
        return json(await claimRun(context.db, body.token, { wallet: context.wallet, sessionHash: context.currentId }, binding.data));
      } catch (error) {
        if (error instanceof RunClaimError && error.code === "claim_unavailable") return unavailable();
        if (error instanceof RunClaimError && error.code === "claim_unauthenticated") return json({ error: "unauthenticated" }, 401);
        return json({ error: "claims_unavailable" }, 503);
      }
    },
    async LIST(request: Request): Promise<Response> {
      if (!available || !binding.success) return json({ error: "history_unavailable" }, 503);
      try {
        const input = parseHistoryQuery(new URL(request.url).searchParams);
        const context = await authenticate(request, false); if (context instanceof Response) return context;
        return json(await readRunOwnershipHistory(requireRunOwnershipHistory(context.db), context.wallet, binding.data, input));
      } catch (error) {
        return error instanceof ZodError || error instanceof HistoryError && error.code === "invalid_history_query"
          ? json({ error: "invalid_history_query" }, 400) : json({ error: "history_unavailable" }, 503);
      }
    },
    async DETAIL(request: Request, id: string): Promise<Response> {
      if (!available || !binding.success) return json({ error: "history_unavailable" }, 503);
      try {
        if (new URL(request.url).search || !runClaimIdSchema.safeParse(id).success) return json({ error: "invalid_history_query" }, 400);
        const context = await authenticate(request, false); if (context instanceof Response) return context;
        const item = await requireRunOwnershipHistory(context.db).read(context.wallet, binding.data, id);
        if (!item) return json({ error: "run_unavailable" }, 404);
        const ownership = runOwnershipSchema.parse(item.ownership);
        const run = ownershipHistoryOriginal(item.run, context.wallet, id, item.run.createdAt, ownership);
        return json({ version: 1, wallet: context.wallet, binding: binding.data, run, ownership });
      } catch { return json({ error: "history_unavailable" }, 503); }
    },
  };
}
