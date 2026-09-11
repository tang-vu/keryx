import { z } from "zod";
import { readBoundedRequestJson } from "../read-bounded-request-json";
import { withdrawPolicySchema } from "./withdraw-protocol";
import { withdrawalOwnerSchema } from "./withdrawal-request";
import { prepareWithdrawIntent } from "./withdraw-intent";
import { createWithdrawalBrowserDraft } from "./withdrawal-browser-journal";
import { withdrawalHeightWindowForRpc } from "./withdrawal-height-window";
import { estimateWithdrawalIntent, matchWithdrawalEstimate } from "./withdrawal-estimate";
import { checkWithdrawalRateLimit } from "./withdrawal-rate-limit";
import type { KeryxDB } from "../db/keryx-db";

type Context = { wallet: string; currentId: string; db: Pick<KeryxDB, "consumeRateLimit"> };
const input = z.object({ amountMicros: z.string().regex(/^[1-9][0-9]{0,77}$/) }).strict();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Authenticated unsigned preparation only. No gas hold, transfer claim, wallet
 * signature or payment; callers must save and review the returned draft first. */
export function createWithdrawalPrepareHandler(options: { authenticate: () => Promise<Context | Response>;
  limits: Omit<z.infer<typeof withdrawPolicySchema>, "owner" | "recipient">; rpcUrl: string;
  heightLimits: Parameters<typeof withdrawalHeightWindowForRpc>[2] }) {
  const { authenticate, rpcUrl } = options, limits = withdrawPolicySchema.omit({ owner: true, recipient: true }).parse(options.limits);
  const heightLimits = { ...options.heightLimits };
  if (limits.domain !== 26) throw new Error("Withdrawal preparation network unavailable");
  return async (req: Request) => {
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    try {
      const origin = req.headers.get("origin");
      if (!origin || new URL(origin).host !== req.headers.get("host")) return json({ error: "Same-origin request required." }, 403);
      if (new URL(req.url).search) return json({ error: "Put withdrawal terms in the request body." }, 400);
      const context = await authenticate(); if (context instanceof Response) return context;
      const owner = withdrawalOwnerSchema.parse(context.wallet), limited = await checkWithdrawalRateLimit(context.db, owner, "prepare");
      if (limited) return limited;
      let amount: string;
      try {
        if (req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error();
        amount = input.parse(await readBoundedRequestJson(req, 1024)).amountMicros;
        if (BigInt(amount) > BigInt(limits.maxValueMicros)) throw new Error();
      } catch { return json({ error: "Invalid withdrawal amount." }, 400); }
      const live = async () => {
        req.signal.throwIfAborted(); const fresh = await authenticate();
        if (fresh instanceof Response || fresh.wallet.toLowerCase() !== owner || fresh.currentId !== context.currentId) throw new Error();
        req.signal.throwIfAborted();
      };
      await live();
      const policy = withdrawPolicySchema.parse({ ...limits, owner, recipient: owner, maxValueMicros: amount });
      const candidate = prepareWithdrawIntent(owner, BigInt(amount), owner); candidate.maxFee = policy.maxFeeMicros;
      createWithdrawalBrowserDraft(candidate, policy); // Reject configuration drift before vendor access.
      const window = await withdrawalHeightWindowForRpc(rpcUrl, policy, heightLimits, req.signal); await live();
      const bounds = { minimumBlockHeight: window.minimumBlockHeight, maximumBlockHeight: window.maximumBlockHeight };
      const estimated = await estimateWithdrawalIntent(candidate, policy, bounds, req.signal); await live();
      const fresh = await withdrawalHeightWindowForRpc(rpcUrl, policy, heightLimits, req.signal); await live();
      const checked = matchWithdrawalEstimate([{ burnIntent: estimated }], candidate, policy,
        { minimumBlockHeight: fresh.minimumBlockHeight, maximumBlockHeight: fresh.maximumBlockHeight });
      return json({ wallet: owner, draft: createWithdrawalBrowserDraft(checked, policy), preparedAt: new Date().toISOString() });
    } catch { return json({ error: "Withdrawal preparation unavailable. No new authorization was signed." }, 503); }
  };
}
