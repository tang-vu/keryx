"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { readBoundedJson } from "@/lib/read-bounded-json";
import { decisionReviewSchema, type DecisionReview, type ReviewVerdictInput } from "@/lib/research/decision-review-types";
import { decisionReviewCopy as copy, reviewCopyText } from "@/lib/research/decision-review-copy";

export function DecisionReviews({ runId, records, capturedOwner, live = false }: {
  runId?: string; records?: DecisionReview[]; capturedOwner?: string | null; live?: boolean;
}) {
  const { session } = useSiweAuth();
  if (!session) return <p className="mt-3 text-xs text-ink-3"><Link href="/connect">{copy.signedOut}</Link></p>;
  const wallet = session.address.toLowerCase();
  if (records && capturedOwner !== wallet) return <p role="status" className="mt-3 text-xs text-ink-3">{copy.ownerChanged}</p>;
  const id = runId ?? records?.[0]?.runId;
  if (!id) return null;
  return <ReviewEditor key={`${wallet}:${id}`} wallet={wallet} runId={id} incoming={records} live={live} />;
}
export function ReviewEditor({ wallet, runId, incoming, live }: { wallet: string; runId: string; incoming?: DecisionReview[]; live: boolean }) {
  const [loaded, setLoaded] = useState<DecisionReview[] | null>(null), [updates, setUpdates] = useState<Record<string, DecisionReview>>({});
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const active = useRef(true), controller = useRef<AbortController | null>(null), attempt = useRef<ReviewVerdictInput | null>(null);
  const seenIncoming = useRef(new Map<string, DecisionReview>());
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (!live) return; const timer = setInterval(() => setObservedAt(Date.now()), 500); return () => clearInterval(timer); }, [live]);
  useEffect(() => {
    const changed = (incoming ?? []).filter(row => seenIncoming.current.get(row.id) !== row);
    for (const row of changed) seenIncoming.current.set(row.id, row);
    if (changed.length) setLoaded(current => current === null ? null : [...new Map([...current, ...changed].map(row => [row.id, row])).values()]);
  }, [incoming]);
  const records = (loaded ?? incoming ?? []).map(row => {
    const update = updates[row.id]; if (!update) return row;
    if (row.state === "consumed" && update.state === "approved") return { ...update, state: row.state };
    if (["expired", "cancelled"].includes(row.state)) return row;
    return update;
  });
  const request = async (input?: ReviewVerdictInput) => {
    if (controller.current) return;
    const owned = new AbortController(); controller.current = owned;
    setBusy(true); setNotice(input ? "" : copy.loading);
    try {
      const response = await fetch(input ? "/api/me/decision-reviews" : `/api/me/decision-reviews?runId=${encodeURIComponent(runId)}`, {
        method: input ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { "X-Keryx-Expected-Wallet": wallet, ...(input ? { "Content-Type": "application/json" } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.any([owned.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) throw new Error("Review refused");
      const value = await readBoundedJson(response, 4_000_000) as { review?: unknown; reviews?: unknown };
      if (!active.current || owned.signal.aborted) return;
      if (input) { const record = decisionReviewSchema.parse(value.review); if (record.id !== input.id || record.runId !== runId) throw new Error();
        setUpdates(current => ({ ...current, [record.id]: record })); attempt.current = null; setPending(false); setNotice(copy.saved); }
      else { if (!Array.isArray(value.reviews) || value.reviews.length > 300) throw new Error();
        const rows = value.reviews.map((row: unknown) => decisionReviewSchema.parse(row)); if (rows.some((row: DecisionReview) => row.runId !== runId)) throw new Error(); setLoaded(rows); setUpdates({});
        const old = attempt.current, checked = old ? rows.find(row => row.id === old.id) : undefined;
        // An explicit readback of a terminal gate permits future opinions only.
        // It neither claims the lost ACK was received nor emits another verdict.
        if (old?.context === "gate" && checked && ["consumed", "declined", "expired", "cancelled"].includes(checked.state)) { attempt.current = null; setPending(false); setNotice(copy.closed); }
        else if (old?.context === "opinion" && checked && (old.expectedCode?.action !== checked.codeAction || old.expectedCode?.rule !== checked.codeRule)) {
          attempt.current = null; setPending(false); setNotice(copy.opinionChanged);
        }
        else setNotice(rows.length ? "" : copy.empty); }
    } catch { if (active.current && !owned.signal.aborted) setNotice(copy.failed); }
    finally { if (controller.current === owned) controller.current = null; if (active.current) setBusy(false); }
  };
  const vote = (record: DecisionReview, value: "agree" | "disagree") => {
    const context = record.state === "held" ? "gate" : "opinion";
    const old = attempt.current;
    if (old && (old.id !== record.id || old.value !== value || old.context !== context)) { setNotice(copy.failed); return; }
    const input = old ?? { id: record.id, key: crypto.randomUUID(), context, value,
      ...(context === "opinion" ? { expectedCode: { action: record.codeAction, rule: record.codeRule } } : {}),
      ...(reasons[record.id]?.trim() ? { reason: reasons[record.id].trim() } : {}) };
    attempt.current = input; setPending(true); void request(input);
  };
  return <section className="mt-4 min-w-0 border border-line bg-paper p-4" aria-label={copy.title}>
    <h2 className="font-mono text-sm text-ink">{copy.title}</h2>
    <p className="mt-2 text-xs text-ink-3">{copy.identity}</p>
    <p className="mt-2 text-xs text-ink-3">{copy.heldNotice}</p>
    <Link href="/decision-reviews" className="mt-2 inline-block text-xs underline">{copy.metrics}</Link>
    <button type="button" disabled={busy} onClick={() => void request()} className="mt-2 min-h-11 border border-line px-3 py-2 font-mono text-xs">{loaded || incoming ? copy.refresh : copy.load}</button>
    {pending && <button type="button" disabled={busy} onClick={() => { const input = attempt.current; if (input) void request(input); }} className="ml-2 mt-2 min-h-11 border border-line px-3 py-2 font-mono text-xs">{copy.retry}</button>}
    {notice && <p role="status" className="mt-2 text-sm text-ink-2">{notice}</p>}
    <ul className="mt-3 space-y-3">{records.map(record => {
      const held = live && record.state === "held" && Date.parse(record.expiresAt ?? "") > observedAt;
      const closed = record.state === "held" && !held || ["expired", "cancelled", "declined"].includes(record.state);
      return <li key={record.id} className="min-w-0 border-t border-line pt-3">
        <h3 className="break-words font-serif text-base">{record.sourceName}</h3>
        <p className="mt-1 text-xs text-ink-3">{reviewCopyText(copy.actions, { model: record.modelAction ?? copy.unknownModel, code: record.codeAction, rule: record.codeRule })}</p>
        <p className="mt-1 break-words text-xs text-ink-3">{reviewCopyText(copy.terms, { price: record.terms.priceMicroUsdc, listPrice: record.terms.listPriceMicroUsdc, reward: record.terms.citationBudgetMicroUsdc, network: record.terms.network })}</p>
        {record.terms.payTo && <p className="mt-1 break-all text-xs text-ink-3">{reviewCopyText(copy.payee, { payee: record.terms.payTo })}</p>}
        {held && <p role="status" className="mt-2 text-sm text-seal">{copy.waiting}</p>}
        {closed && <p className="mt-2 text-xs text-ink-3">{copy.closed}</p>}
        <label className="mt-2 block text-xs text-ink-2">{copy.reason}
          <textarea rows={2} maxLength={1000} value={reasons[record.id] ?? ""} onChange={event => setReasons(current => ({ ...current, [record.id]: event.target.value }))} className="mt-1 block w-full min-w-0 border border-line bg-paper px-2 py-2" />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">{(["agree", "disagree"] as const).map(value => <button key={value} type="button" disabled={busy || pending || record.state === "approved" || record.state === "held" && !held}
          onClick={() => vote(record, value)} className="min-h-11 border border-line px-3 py-2 font-mono text-xs disabled:opacity-50">{copy[value]}</button>)}</div>
        {record.verdict && <div className="mt-2 text-xs text-ink-2"><p className="whitespace-pre-wrap break-words">{copy[record.verdict.value]}{record.verdict.reason ? `: ${record.verdict.reason}` : ""}</p>
          <p>{reviewCopyText(record.verdict.context === "gate" ? copy.gateBasis : copy.opinionBasis, { action: record.verdict.codeAction, rule: record.verdict.codeRule })}</p></div>}
      </li>;
    })}</ul>
  </section>;
}
