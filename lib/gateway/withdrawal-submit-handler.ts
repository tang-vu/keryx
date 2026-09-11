import { readBoundedRequestJson } from "../read-bounded-request-json";
import { createWithdrawalRequest, withdrawalOwnerSchema, type WithdrawalRequestRecord } from "./withdrawal-request";
import { withdrawPolicySchema, withdrawRequestSchema } from "./withdraw-protocol";
import { submitWithdrawalTransfer } from "./withdrawal-transfer-service";
import { checkWithdrawalRateLimit } from "./withdrawal-rate-limit";
import type { KeryxDB } from "../db/keryx-db";

const limitsSchema = withdrawPolicySchema.omit({ owner: true, recipient: true }).refine(value => value.domain === 26);
type Store = Parameters<typeof submitWithdrawalTransfer>[0] & Pick<KeryxDB, "consumeRateLimit">;
type Context = { db: Store; wallet: string; currentId: string };
type Limits = Omit<WithdrawalRequestRecord["policy"], "owner" | "recipient">;
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Server-only boundary, not yet registered as a public route. All dependencies and
 * limits must come from server configuration/live sessions. admit must establish
 * backed durable relay gas admission. Request limits use the authenticated store. */
export function createWithdrawalSubmitHandler(options: {
  authenticate: () => Promise<Context | Response>; limits: Limits;
  admit: (record: WithdrawalRequestRecord, signal: AbortSignal) => Promise<void>;
  transfer: Parameters<typeof submitWithdrawalTransfer>[4];
}) {
  const { authenticate, admit, transfer } = options;
  const limits = limitsSchema.parse(structuredClone(options.limits));
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    try {
      const origin = req.headers.get("origin");
      if (!origin || new URL(origin).host !== req.headers.get("host")) return json({ error: "Same-origin request required." }, 403);
      if (new URL(req.url).search) return json({ error: "Withdrawal data belongs in the request body." }, 400);
    } catch { return json({ error: "Invalid request origin." }, 403); }
    try {
      const context = await authenticate();
      if (context instanceof Response) return context;
      const owner = withdrawalOwnerSchema.parse(context.wallet), limited = await checkWithdrawalRateLimit(context.db, owner, "submit");
      if (limited) {
        const headers = new Headers(limited.headers); headers.set("Cache-Control", "no-store");
        return new Response(limited.body, { status: limited.status, headers });
      }
      let record: WithdrawalRequestRecord;
      try {
        if (req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error();
        const request = withdrawRequestSchema.parse(await readBoundedRequestJson(req, 8192));
        if (BigInt(request.burnIntent.spec.value) > BigInt(limits.maxValueMicros)) throw new Error();
        record = await createWithdrawalRequest(request, withdrawPolicySchema.parse({ ...limits, owner, recipient: owner,
          maxValueMicros: request.burnIntent.spec.value }));
      } catch { return json({ error: "Invalid withdrawal authorization or limits." }, 400); }
      const requireSession = async () => {
        req.signal.throwIfAborted();
        const current = await authenticate();
        if (current instanceof Response || current.wallet.toLowerCase() !== owner || current.currentId !== context.currentId)
          throw new Error("Withdrawal session unavailable");
        req.signal.throwIfAborted();
      };
      // Limit/body/signature validation and admission can outlive the original session.
      await requireSession();
      const result = await submitWithdrawalTransfer(context.db, record, owner, async (original, signal) => {
        await requireSession(); await admit(original, signal); await requireSession();
      }, async (original, signal) => {
        await requireSession(); return transfer(original, signal);
      }, req.signal);
      await requireSession();
      return result ? json({ wallet: owner, ...result, mintStatus: "not-checked" }, 202)
        : json({ error: "Withdrawal outcome unavailable. Recover the original request." }, 503);
    } catch {
      return json({ error: "Withdrawal outcome unavailable. Recover the original request; do not create another authorization." }, 503);
    }
  };
}
