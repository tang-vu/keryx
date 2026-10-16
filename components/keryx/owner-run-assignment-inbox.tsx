"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { formatLocalizedInstant } from "@/lib/i18n/format";
import { ownerRunAssignmentMessages as copy } from "@/locales/en/owner-run-assignments";
import { manifestSchema, type Manifest, type RecipientAction } from "@/lib/owner-run-assignments/contracts";
import { inboxSchema, type AssignmentInbox, type InboxItem } from "@/lib/owner-run-assignments/projection";
import { useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_copy = copy;


const button = "min-h-11 border border-line px-4 py-2 disabled:opacity-50";
type Recovery = { expected: AssignmentInbox["recipient"]; input: RecipientAction };
function sameRecipient(left: Recovery["expected"], right: Recovery["expected"]) {
  return left.accountId === right.accountId && left.accountCreatedAt === right.accountCreatedAt
    && left.memberGeneration === right.memberGeneration && left.wallet === right.wallet;
}
export function OwnerRunAssignmentInbox({ readOnlyView = false }: { readOnlyView?: boolean } = {}) {
  const copy = useUiCopy("owner-run-assignments", uiEnglish_copy);
  const { session } = useSiweAuth();
  if (session === undefined) return <p role="status">{copy.checking}</p>;
  if (!session) return <Link href="/connect">{copy.signIn}</Link>;
  return <Editor key={`${session.address.toLowerCase()}:${session.role}:${readOnlyView ? "read" : "manage"}`}
    wallet={session.address.toLowerCase()} readOnlyView={readOnlyView} />;
}
function Editor({ wallet, readOnlyView = false }: { wallet: string; readOnlyView?: boolean }) {
  const copy = useUiCopy("owner-run-assignments", uiEnglish_copy);
  const recoveryId = useId();
  const [inbox, setInbox] = useState<AssignmentInbox | null>(null), [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Manifest | null>(null), [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  // One unresolved intent, memory only. Invalidation hides it; only a fresh GET
  // for its exact recipient can expose it again. Unmount destroys the holder.
  const pendingRecovery = useRef<Recovery | null>(null), qualified = useRef<Recovery["expected"] | null>(null);
  const epoch = useRef(0), locked = useRef(false), controllers = useRef(new Set<AbortController>());
  const active = useRef(false);
  async function request(body?: Recovery) {
    // The transport guard also fences detached handlers from a retired editor.
    if (!active.current || body && readOnlyView) throw new Error(copy.changed);
    const attempt = epoch.current, controller = new AbortController(); controllers.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/me/run-assignments", { method: body ? "POST" : "GET", credentials: "same-origin",
        cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
        headers: { "x-keryx-expected-wallet": wallet, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const raw: unknown = await response.json();
      if (epoch.current !== attempt || controller.signal.aborted) throw new Error(copy.changed);
      if (!response.ok) throw new Error(copy.unavailable);
      const next = inboxSchema.parse(raw);
      if (next.recipient.wallet !== wallet || body && next.receipt?.requestId !== body.input.requestId) throw new Error(copy.invalid);
      qualified.current = next.recipient;
      setInbox(next); setMessage(body?.input.action === "consent" ? copy.pendingConsent : "");
      return next;
    } finally { clearTimeout(timer); controllers.current.delete(controller); }
  }
  async function refresh() {
    if (!active.current || locked.current) return;
    const attempt = epoch.current;
    locked.current = true; setBusy(true);
    qualified.current = null; setRecovery(null); setInbox(null); setProposal(null);
    try {
      const next = await request();
      if (epoch.current !== attempt) return;
      const pending = pendingRecovery.current;
      if (pending && sameRecipient(pending.expected, next.recipient)) { setRecovery(pending); setMessage(copy.unknown); }
    } catch { if (epoch.current === attempt) { setInbox(null); setMessage(copy.unavailable); } }
    finally { if (epoch.current === attempt) { locked.current = false; setBusy(false); } }
  }
  useEffect(() => {
    active.current = true;
    const pendingControllers = controllers.current;
    const invalidate = () => { epoch.current++; for (const controller of pendingControllers) controller.abort();
      qualified.current = null; setRecovery(null); setInbox(null); setProposal(null); setMessage(copy.changed);
      locked.current = false; setBusy(false); };
    void refresh();
    window.addEventListener("keryx:auth", invalidate); window.addEventListener("focus", invalidate);
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("keryx-auth-v1"); channel.onmessage = invalidate; } catch { /* Focus/auth event invalidation remains. */ }
    return () => { active.current = false; epoch.current++; for (const controller of pendingControllers) controller.abort();
      pendingRecovery.current = null; qualified.current = null; locked.current = false;
      window.removeEventListener("keryx:auth", invalidate); window.removeEventListener("focus", invalidate); channel?.close(); };
    // Wallet, role and mode changes retire the entire editor and its authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, readOnlyView]);
  async function mutate(body: Recovery) {
    if (readOnlyView || !active.current || locked.current || !qualified.current || !sameRecipient(body.expected, qualified.current)
      || pendingRecovery.current && pendingRecovery.current !== body) return;
    const attempt = epoch.current;
    locked.current = true; setBusy(true); pendingRecovery.current = body; setRecovery(body);
    try { await request(body); if (epoch.current === attempt) { pendingRecovery.current = null; setRecovery(null); } }
    catch { if (epoch.current === attempt) { setInbox(null); setMessage(copy.unknown); } }
    finally { if (epoch.current === attempt) { locked.current = false; setBusy(false); } }
  }
  function consent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (readOnlyView || !active.current || !inbox || !proposal || !sameRecipient(proposal.recipient, inbox.recipient) || pendingRecovery.current) return;
    void mutate({ expected: inbox.recipient, input: { action: "consent", requestId: crypto.randomUUID(), manifest: proposal,
      acknowledgeAssignedLabel: true, noFinancialAuthority: true } });
  }
  function decide(row: InboxItem, action: "confirm" | "reject" | "withdraw") {
    if (readOnlyView || !active.current || !inbox || pendingRecovery.current) return;
    void mutate({ expected: inbox.recipient, input: { action, requestId: crypto.randomUUID(), expected: { assignmentId: row.assignmentId, revision: row.revision } } });
  }
  const RowHeading = readOnlyView ? "h3" : "h2";
  return <section className="space-y-5" aria-label={copy.title}>
    {readOnlyView && <><h2 className="font-serif text-xl text-ink">{copy.title}</h2>
      <Link className="underline" href="/me/run-assignments">{copy.menu}</Link></>}
    <p>{copy.scope}</p><button className={button} disabled={busy} onClick={() => { void refresh(); }}>{copy.refresh}</button>
    {message && <p role="status">{message}</p>}
    {!readOnlyView && recovery && <div><label htmlFor={recoveryId}>{copy.recovery}</label><textarea id={recoveryId} readOnly className="block w-full border border-line" value={JSON.stringify(recovery)} />
      <button className={button} disabled={busy} onClick={() => { void mutate(recovery); }}>{copy.resolve}</button></div>}
    {inbox && <><div aria-label={copy.profile}><p>{copy.assignedCount}: {inbox.profile.assignedByOwner}</p>
      <p>{copy.claimedCount}: {inbox.profile.claimedFromOwnerAssignment}</p></div>
      {inbox.receipt && <p>{copy.historical} <code>{inbox.receipt.requestId}</code></p>}
      {!inbox.history.length && <p>{copy.empty}</p>}
      <ul>{inbox.history.map(row => <li className="space-y-2 border border-line p-4" key={row.assignmentId}>
        <RowHeading>{row.effective ? row.attribution === "claimed-from-owner-assignment" ? copy.claimed : copy.assigned : copy.suppressed}</RowHeading>
        <code>{row.assignmentId}</code>
        {row.effective && <p>{row.runId} · {row.network}</p>}
        <p>{copy.assignedAt}: <time dateTime={new Date(row.assignedAt).toISOString()}>{formatLocalizedInstant(row.assignedAt, "en", "dateTimeSecondsZone")}</time></p>
        {row.confirmedAt !== null && <p>{copy.confirmedAt}: <time dateTime={new Date(row.confirmedAt).toISOString()}>{formatLocalizedInstant(row.confirmedAt, "en", "dateTimeSecondsZone")}</time></p>}
        {!readOnlyView && row.status === "assigned-by-owner" && <><button className={button} disabled={busy || !!pendingRecovery.current || !row.effective} onClick={() => decide(row, "confirm")}>{copy.confirm}</button>
          <button className={button} disabled={busy || !!pendingRecovery.current} onClick={() => decide(row, "reject")}>{copy.reject}</button></>}
        {!readOnlyView && row.status === "claimed" && <button className={button} disabled={busy || !!pendingRecovery.current} onClick={() => decide(row, "withdraw")}>{copy.withdraw}</button>}
      </li>)}</ul>
      {!readOnlyView && <form onSubmit={consent} className="space-y-3 border border-line p-4">
        <label>{copy.consentManifest}<textarea maxLength={16384} className="block w-full border border-line" required onChange={event => {
          try { const text = event.target.value; if (new TextEncoder().encode(text).length > 16_384) throw new Error();
            const parsed = manifestSchema.parse(JSON.parse(text));
            if (!inbox || !sameRecipient(parsed.recipient, inbox.recipient)) throw new Error();
            setProposal(parsed); } catch { setProposal(null); }
        }} /></label>
        {proposal && <div><p>{copy.proposalSummary}</p><ul>{proposal.members.map(member => <li key={member.assignmentId}>{member.runId} · {proposal.binding.network}</li>)}</ul></div>}
        <label className="block"><input type="checkbox" required /> {copy.acknowledgement}</label>
        <label className="block"><input type="checkbox" required /> {copy.financialAcknowledgement}</label>
        <button className={button} disabled={busy || !!pendingRecovery.current || !proposal}>{copy.consent}</button>
      </form>}</>}
  </section>;
}
