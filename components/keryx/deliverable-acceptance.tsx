"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { acceptanceSnapshotSchema, publicAcceptanceSchema, deliverableIdSchema,
  type AcceptanceInput, type AcceptanceSnapshot, type PublicAcceptance } from "@/lib/deliverable-acceptance/contracts";
import { readBoundedJson } from "@/lib/read-bounded-json";
import { deliverableAcceptanceCopy as copy } from "@/locales/en/deliverable-acceptance";

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
const label = (state: string) => state === "accepted" ? copy.accepted : state === "revision_requested" ? copy.revised : state === "rejected" ? copy.rejected : copy.noResponse;
export function DeliverableAcceptance({ id, answer }: { id: string; answer: string }) {
  const { session } = useSiweAuth();
  const [publicRevision, setPublicRevision] = useState(0);
  if (!deliverableIdSchema.safeParse(id).success) return null;
  return <section aria-label={copy.heading} className="mt-6 border border-line bg-paper p-5">
    <h2 className="font-display text-2xl">{copy.heading}</h2>
    <p className="mt-2 text-sm">{copy.scope}</p>
    <PublicState key={id} id={id} revision={publicRevision} />
    {session === undefined ? <p role="status">{copy.loading}</p> : session
      ? <OwnerChoice key={`${id}:${session.address.toLowerCase()}`} id={id} answer={answer} wallet={session.address.toLowerCase()} onAcknowledged={() => setPublicRevision(value => value + 1)} />
      : <Link href="/connect" className="mt-3 inline-block underline">{copy.signIn}</Link>}
  </section>;
}
function PublicState({ id, revision }: { id: string; revision: number }) {
  const [state, setState] = useState<PublicAcceptance | null>(null);
  useEffect(() => {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
    void fetch(`/api/deliverables/${id}/acceptance`, { cache: "no-store", credentials: "omit", signal: abort.signal })
      .then(async response => response.ok ? publicAcceptanceSchema.parse(await readBoundedJson(response, 4096)) : null)
      .then(value => { if (!abort.signal.aborted) setState(value); }).catch(() => {});
    return () => { clearTimeout(timer); abort.abort(); };
  }, [id, revision]);
  return <p className="mt-2 text-sm">{state ? state.state !== "not_shared" ? `${copy.publicHeading}: ${label(state.state)}` : copy.notShared : copy.publicUnavailable}</p>;
}
function OwnerChoice({ id, wallet, answer, onAcknowledged }: { id: string; wallet: string; answer: string; onAcknowledged: () => void }) {
  const [snapshot, setSnapshot] = useState<AcceptanceSnapshot | null>(null), [reason, setReason] = useState("");
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [pending, setPending] = useState<AcceptanceInput | null>(null);
  const [verifiedAnswer, setVerifiedAnswer] = useState<{ answer: string; digest: string } | null>(null);
  const answerMatches = !!verifiedAnswer && verifiedAnswer.answer === answer && verifiedAnswer.digest === snapshot?.answerDigest;
  const live = useRef(true);
  const path = `/api/me/deliverables/${id}/acceptance`;
  useEffect(() => {
    let active = true;
    void crypto.subtle.digest("SHA-256", new TextEncoder().encode(answer)).then(bytes => {
      const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
      if (active) setVerifiedAnswer({ answer, digest });
    }).catch(() => { if (active) setVerifiedAnswer(null); });
    return () => { active = false; };
  }, [answer, snapshot?.answerDigest]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function request(input?: AcceptanceInput) {
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method: input ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
        headers: { "X-Keryx-Expected-Wallet": wallet, ...(input ? { "Content-Type": "application/json" } : {}) },
        body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(response.status === 409 ? copy.conflict : input ? copy.failed : copy.unavailable);
      const result = acceptanceSnapshotSchema.parse(await readBoundedJson(response, 16384));
      if (result.wallet !== wallet || result.id !== id) throw new Error(copy.unavailable);
      if (!live.current) return;
      setSnapshot(result); if (input) setPending(null);
      onAcknowledged();
    } catch (cause) { if (live.current) setError(cause instanceof Error && [copy.conflict, copy.failed, copy.unavailable].some(message => message === cause.message) ? cause.message : copy.failed); }
    finally { if (live.current) setBusy(false); }
  }
  useEffect(() => {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
    void fetch(path, { cache: "no-store", headers: { "X-Keryx-Expected-Wallet": wallet }, signal: abort.signal })
      .then(async response => { if (!response.ok) throw new Error(copy.unavailable); return acceptanceSnapshotSchema.parse(await readBoundedJson(response, 16384)); })
      .then(result => { if (!abort.signal.aborted && result.wallet === wallet && result.id === id) setSnapshot(result); })
      .catch(() => { if (!abort.signal.aborted) setError(copy.unavailable); });
    return () => { clearTimeout(timer); abort.abort(); };
  }, [path, wallet, id]);
  const submit = (choice: AcceptanceInput["choice"]) => {
    if (!snapshot || pending || !answerMatches) return;
    const input: AcceptanceInput = { originalFingerprint: snapshot.originalFingerprint, deliveredDigest: snapshot.deliveredDigest,
      expectedRevision: snapshot.revision, idempotencyKey: crypto.randomUUID(), choice, reason, publishState: consent };
    setPending(input); void request(input);
  };
  return <div className="mt-4 space-y-3">
    <p className="text-sm">{copy.terms}</p>
    {snapshot && <>
      <p role="status">{label(snapshot.state)}</p>
      <p className="break-all font-mono text-xs">{copy.digest}: {snapshot.deliveredDigest}</p>
      {!answerMatches && <p role="alert" className="text-sm text-seal">{verifiedAnswer?.answer === answer ? copy.changedAnswer : copy.verifyingAnswer}</p>}
      {snapshot.pendingPaymentLegs && <p className="text-sm text-seal">{copy.pending}</p>}
      <label className="block text-sm">{copy.reason}<textarea maxLength={1000} value={reason} disabled={busy || !!pending}
        onChange={event => setReason(event.target.value)} className="mt-2 block w-full border border-line bg-paper p-2" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy || !!pending} onChange={event => setConsent(event.target.checked)} />{copy.consent}</label>
      <p className="text-xs text-ink-3">{copy.privateNotice}</p>
      <div className="flex flex-wrap gap-2">
        <button className={control} disabled={busy || !!pending || !answerMatches || snapshot.revision >= 100} onClick={() => submit("accept")}>{copy.accept}</button>
        <button className={control} disabled={busy || !!pending || !answerMatches || snapshot.revision >= 100} onClick={() => submit("revise")}>{copy.revise}</button>
        <button className={control} disabled={busy || !!pending || !answerMatches || snapshot.revision >= 100} onClick={() => submit("reject")}>{copy.reject}</button>
      </div>
    </>}
    <button className={control} disabled={busy} onClick={() => void request()}>{copy.refresh}</button>
    {pending && <button className={`${control} ml-2`} disabled={busy} onClick={() => void request(pending)}>{copy.retry}</button>}
    {pending && <><button className={`${control} ml-2`} disabled={busy} onClick={() => setPending(null)}>{copy.discard}</button><p className="text-xs">{copy.discardNotice}</p></>}
    {busy && <p role="status">{copy.busy}</p>}{error && <p role="alert" className="text-sm text-seal">{error}</p>}
  </div>;
}
