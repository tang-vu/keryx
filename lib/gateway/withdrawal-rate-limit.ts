import { createHash } from "node:crypto";
import type { KeryxDB } from "../db/keryx-db";
import { withdrawalOwnerSchema } from "./withdrawal-request";

const WINDOW_MS = 60000;
const budgets = { prepare: { wallet: 3, service: 20 }, submit: { wallet: 3, service: 20 },
  status: { wallet: 30, service: 200 }, history: { wallet: 10, service: 100 } } as const;

/** Durable authority only, with no in-process fallback. Tier is selected by server
 * code, wallet by live authentication. Counters are not settlement or gas accounting. */
export async function checkWithdrawalRateLimit(db: Pick<KeryxDB, "consumeRateLimit">, wallet: string,
  tier: keyof typeof budgets): Promise<Response | null> {
  try {
    const owner = withdrawalOwnerSchema.parse(wallet), policy = budgets[tier];
    if (!policy) throw new Error();
    const digest = createHash("sha256").update(`keryx-withdrawal-owner-v1:${owner}`).digest("hex"), now = Date.now();
    // A denied wallet does not consume additional service capacity. A denied service
    // check retains the wallet point; lost readback never rolls either counter back.
    for (const [bucket, points] of [[`withdrawal:${tier}:wallet:${digest}`, policy.wallet],
      [`withdrawal:${tier}:service`, policy.service]] as const) {
      const decision = await db.consumeRateLimit(bucket, points, WINDOW_MS, now);
      if (typeof decision.allowed !== "boolean" || !Number.isSafeInteger(decision.msBeforeNext)
        || decision.msBeforeNext < 0 || decision.msBeforeNext > WINDOW_MS) throw new Error();
      if (!decision.allowed) {
        const retryAfter = Math.max(1, Math.ceil(decision.msBeforeNext / 1000));
        return Response.json({ error: "Withdrawal request limit reached. Retain the original request and retry recovery later.", retryAfter },
          { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } });
      }
    }
    return null;
  } catch {
    return Response.json({ error: "Withdrawal request limits are temporarily unavailable. Retain the original request." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
