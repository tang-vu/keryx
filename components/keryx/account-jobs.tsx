"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { accountHistorySchema } from "@/lib/a2a/account-history-types";
import { paidJobEscalationSchema } from "@/lib/a2a/overdue-types";
import { readAccountMetadata } from "@/lib/buyer/account-owned-transport";
import { pendingOwner257Copy as copy } from "@/locales/en/pending-owner257";

const ownedRow = accountHistorySchema.shape.jobs.element.extend({ escalation: paidJobEscalationSchema, attention: z.enum(["needs_review", "unknown"]), recoveryState: z.enum(["held", "unknown"]) });
const ownedPacket = z.object({ wallet: accountHistorySchema.shape.wallet, jobs: z.array(ownedRow).max(25), nextCursor: accountHistorySchema.shape.nextCursor,
  ownership: z.literal("authenticated_original"), recoveryState: z.literal("unknown") }).strict();
const sessionRows = z.object({ sessions: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), issuedAt: z.number().int(), expiresAt: z.number().int(), current: z.boolean() }).strict()).max(100), truncated: z.boolean() }).strict();
export const ACCOUNT_JOB_READ_TIMEOUT_MS = 5000;

/** Mounted same-original observation only. No payment/recovery command exists. */
export function AccountJobs({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<z.infer<typeof ownedRow> | null>(null);
  useEffect(() => {
    setRow(null);
    if (!/^a2a_[a-f0-9]{64}$/.test(orderId)) return;
    const lifetime = new AbortController();
    let request: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, revision = 0;
    async function observe() {
      if (lifetime.signal.aborted) return;
      const attempt = ++revision, abort = new AbortController(); request = abort;
      const timeout = setTimeout(() => abort.abort(), ACCOUNT_JOB_READ_TIMEOUT_MS);
      let response: Response | undefined;
      const stopped = () => abort.abort(); lifetime.signal.addEventListener("abort", stopped, { once: true });
      let rejectAbort: () => void = () => {};
      const cancelled = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Observation cancelled")); abort.signal.addEventListener("abort", rejectAbort, { once: true }); });
      const current = async () => {
        abort.signal.throwIfAborted();
        const result = await fetch("/api/auth/sessions", { credentials: "same-origin", redirect: "error", cache: "no-store", signal: abort.signal });
        if (abort.signal.aborted) { void result.body?.cancel().catch(() => undefined); abort.signal.throwIfAborted(); }
        if (!result.ok) { void result.body?.cancel().catch(() => undefined); throw new Error("Session unavailable"); }
        const rows = sessionRows.parse(await readAccountMetadata(result, abort.signal, 32768)).sessions.filter(value => value.current);
        abort.signal.throwIfAborted();
        if (rows.length !== 1 || rows[0].issuedAt > Date.now() || rows[0].expiresAt <= Date.now()) throw new Error("Session unavailable");
        return JSON.stringify(rows[0]);
      };
      try {
        const value = await Promise.race([cancelled, (async () => {
          const before = await current();
          abort.signal.throwIfAborted();
          response = await fetch(`/api/me/jobs?pending=owned&id=${encodeURIComponent(orderId)}`, { credentials: "same-origin", redirect: "error", cache: "no-store", signal: abort.signal });
          if (abort.signal.aborted) { void response.body?.cancel().catch(() => undefined); abort.signal.throwIfAborted(); }
          if (!response.ok) throw new Error("Observation unavailable");
          const packet = ownedPacket.parse(await readAccountMetadata(response, abort.signal, 131072));
          abort.signal.throwIfAborted();
          if (before !== await current()) throw new Error("Session replaced");
          const matches = packet.jobs.filter(job => job.id === orderId);
          return matches.length === 1 ? matches[0] : null;
        })()]);
        if (!lifetime.signal.aborted && !abort.signal.aborted && attempt === revision) setRow(value);
      } catch { if (!lifetime.signal.aborted && attempt === revision) setRow(null); }
      finally {
        clearTimeout(timeout); lifetime.signal.removeEventListener("abort", stopped); abort.signal.removeEventListener("abort", rejectAbort); abort.abort();
        void response?.body?.cancel().catch(() => undefined);
        if (request === abort) request = undefined;
        if (!lifetime.signal.aborted && attempt === revision) timer = setTimeout(observe, 2000);
      }
    }
    const changed = () => {
      revision++; request?.abort(); clearTimeout(timer); setRow(null);
      if (!lifetime.signal.aborted) timer = setTimeout(observe, 2000);
    };
    window.addEventListener("keryx:auth", changed); window.addEventListener("focus", changed);
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("keryx-auth-v1"); channel.onmessage = changed; } catch { /* Auth/focus remain. */ }
    void observe();
    return () => {
      revision++; lifetime.abort(); request?.abort(); clearTimeout(timer); channel?.close();
      window.removeEventListener("keryx:auth", changed); window.removeEventListener("focus", changed);
    };
  }, [orderId]);
  if (row?.id !== orderId || row?.attention !== "needs_review") return null;
  return <div role="alert" data-owned-job={orderId} className="mt-3 text-sm text-seal">
    <strong>{copy.title}</strong><p>{row.recoveryState === "held" ? copy.held : copy.failed}</p>
    {row.escalation.creatorPaymentState === "unknown" && <p>{copy.paymentUnknown}</p>}
    {row.recoveryState === "unknown" && <p>{copy.recoveryUnknown}</p>}
  </div>;
}
