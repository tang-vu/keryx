"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { formatLocalizedInstant } from "@/lib/i18n/format";
import { ownerRunAssignmentMessages as copy } from "@/locales/en/owner-run-assignments";
import { manifestSchema, type Manifest, type RecipientAction } from "@/lib/owner-run-assignments/contracts";
import { inboxSchema, type AssignmentInbox, type InboxItem } from "@/lib/owner-run-assignments/projection";

const button = "min-h-11 border border-line px-4 py-2 disabled:opacity-50";
type Recovery = { expected: AssignmentInbox["recipient"]; input: RecipientAction };
export function OwnerRunAssignmentInbox() {
  const { session } = useSiweAuth();
  if (session === undefined) return <p role="status">{copy.checking}</p>;
  if (!session) return <Link href="/connect">{copy.signIn}</Link>;
  return <Editor key={session.address.toLowerCase()} wallet={session.address.toLowerCase()} />;
}
function Editor({ wallet }: { wallet: string }) {
  const [inbox, setInbox] = useState<AssignmentInbox | null>(null), [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Manifest | null>(null), [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const epoch = useRef(0), locked = useRef(false), controllers = useRef(new Set<AbortController>());
  async function request(body?: Recovery) {
    const attempt = epoch.current, controller = new AbortController(); controllers.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/me/run-assignments", { method: body ? "POST" : "GET", credentials: "same-origin",
        cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
        headers: { "x-keryx-expected-wallet": wallet, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const raw: unknown = await response.json();
      if (epoch.current !== attempt) throw new Error(copy.changed);
      if (!response.ok) throw new Error(copy.unavailable);
      const next = inboxSchema.parse(raw);
      if (next.recipient.wallet !== wallet || body && next.receipt?.requestId !== body.input.requestId) throw new Error(copy.invalid);
      setInbox(next); setMessage(body?.input.action === "consent" ? copy.pendingConsent : "");
      return next;
    } finally { clearTimeout(timer); controllers.current.delete(controller); }
  }
  async function refresh() {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { await request(); } catch { setInbox(null); setMessage(copy.unavailable); }
    finally { locked.current = false; setBusy(false); }
  }
  useEffect(() => {
    const pendingControllers = controllers.current;
    const invalidate = () => { epoch.current++; for (const controller of pendingControllers) controller.abort();
      setInbox(null); setProposal(null); setMessage(copy.changed); };
    void refresh();
    window.addEventListener("keryx:auth", invalidate); window.addEventListener("focus", invalidate);
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("keryx-auth-v1"); channel.onmessage = invalidate; } catch { /* Focus/auth event invalidation remains. */ }
    return () => { epoch.current++; for (const controller of pendingControllers) controller.abort();
      window.removeEventListener("keryx:auth", invalidate); window.removeEventListener("focus", invalidate); channel?.close(); };
    // A wallet-keyed instance never carries another wallet's inbox authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);
  async function mutate(body: Recovery) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setRecovery(body);
    try { await request(body); setRecovery(null); }
    catch { setInbox(null); setMessage(copy.unknown); }
    finally { locked.current = false; setBusy(false); }
  }
  function consent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!inbox || !proposal || recovery) return;
    void mutate({ expected: inbox.recipient, input: { action: "consent", requestId: crypto.randomUUID(), manifest: proposal,
      acknowledgeAssignedLabel: true, noFinancialAuthority: true } });
  }
  function decide(row: InboxItem, action: "confirm" | "reject" | "withdraw") {
    if (!inbox || recovery) return;
    void mutate({ expected: inbox.recipient, input: { action, requestId: crypto.randomUUID(), expected: { assignmentId: row.assignmentId, revision: row.revision } } });
  }
  return <section className="space-y-5" aria-label={copy.title}>
    <p>{copy.scope}</p><button className={button} disabled={busy} onClick={() => { void refresh(); }}>{copy.refresh}</button>
    {message && <p role="status">{message}</p>}
    {recovery && <div><label>{copy.recovery}<textarea readOnly className="block w-full border border-line" value={JSON.stringify(recovery)} /></label>
      <button className={button} disabled={busy} onClick={() => { void mutate(recovery); }}>{copy.resolve}</button></div>}
    {inbox && <><div aria-label={copy.profile}><p>{copy.assignedCount}: {inbox.profile.assignedByOwner}</p>
      <p>{copy.claimedCount}: {inbox.profile.claimedFromOwnerAssignment}</p></div>
      {inbox.receipt && <p>{copy.historical} <code>{inbox.receipt.requestId}</code></p>}
      {!inbox.history.length && <p>{copy.empty}</p>}
      <ul>{inbox.history.map(row => <li className="space-y-2 border border-line p-4" key={row.assignmentId}>
        <h2>{row.effective ? row.attribution === "claimed-from-owner-assignment" ? copy.claimed : copy.assigned : copy.suppressed}</h2>
        <code>{row.assignmentId}</code>
        {row.effective && <p>{row.runId} · {row.network}</p>}
        <p>{copy.assignedAt}: <time dateTime={new Date(row.assignedAt).toISOString()}>{formatLocalizedInstant(row.assignedAt, "en", "dateTimeSecondsZone")}</time></p>
        {row.confirmedAt !== null && <p>{copy.confirmedAt}: <time dateTime={new Date(row.confirmedAt).toISOString()}>{formatLocalizedInstant(row.confirmedAt, "en", "dateTimeSecondsZone")}</time></p>}
        {row.status === "assigned-by-owner" && <><button className={button} disabled={busy || !!recovery || !row.effective} onClick={() => decide(row, "confirm")}>{copy.confirm}</button>
          <button className={button} disabled={busy || !!recovery} onClick={() => decide(row, "reject")}>{copy.reject}</button></>}
        {row.status === "claimed" && <button className={button} disabled={busy || !!recovery} onClick={() => decide(row, "withdraw")}>{copy.withdraw}</button>}
      </li>)}</ul>
      <form onSubmit={consent} className="space-y-3 border border-line p-4">
        <label>{copy.consentManifest}<textarea maxLength={16384} className="block w-full border border-line" required onChange={event => {
          try { const text = event.target.value; if (new TextEncoder().encode(text).length > 16_384) throw new Error();
            setProposal(manifestSchema.parse(JSON.parse(text))); } catch { setProposal(null); }
        }} /></label>
        {proposal && <div><p>{copy.proposalSummary}</p><ul>{proposal.members.map(member => <li key={member.assignmentId}>{member.runId} · {proposal.binding.network}</li>)}</ul></div>}
        <label className="block"><input type="checkbox" required /> {copy.acknowledgement}</label>
        <label className="block"><input type="checkbox" required /> {copy.financialAcknowledgement}</label>
        <button className={button} disabled={busy || !!recovery || !proposal}>{copy.consent}</button>
      </form></>}
  </section>;
}
