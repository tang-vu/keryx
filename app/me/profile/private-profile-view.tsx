"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { PROFILE_LINK_KINDS, privateProfileInputSchema, privateProfileSnapshotSchema, privateProfileRecordSchema, type PrivateProfileInput, type PrivateProfileSnapshot } from "@/lib/profiles/private-profile";

const empty: PrivateProfileInput = { displayName: "", handle: "", bio: "", purpose: "", links: [] };
export function PrivateProfileView() {
  const { session } = useSiweAuth();
  if (session === undefined) return <p role="status">Checking your sign-in…</p>;
  if (!session) return <p><Link className="underline" href="/connect">Sign in with your wallet</Link> to edit your private profile.</p>;
  return <ProfileEditor key={session.address.toLowerCase()} wallet={session.address.toLowerCase()} />;
}
/** Remount on owner change: no old private fields survive a wallet switch or sign-out. */
function ProfileEditor({ wallet }: { wallet: string }) {
  const [snapshot, setSnapshot] = useState<PrivateProfileSnapshot | null>(null), [form, setForm] = useState(empty);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const ownerRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    ownerRequest.current = controller;
    fetch("/api/me/profile", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.message ?? "Private profile access is unavailable.");
      const parsed = privateProfileSnapshotSchema.parse(value);
      if (parsed.profile && parsed.profile.wallet !== wallet) throw new Error("Profile owner mismatch.");
      if (!controller.signal.aborted) { setSnapshot(parsed); setForm(parsed.profile ? { displayName: parsed.profile.displayName, handle: parsed.profile.handle, bio: parsed.profile.bio, purpose: parsed.profile.purpose, links: parsed.profile.links } : empty); setMessage(""); }
    }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Profile unavailable."); });
    return () => controller.abort();
  }, [wallet]);
  const change = (key: "displayName" | "handle" | "bio" | "purpose", value: string) => setForm(current => ({ ...current, [key]: value }));
  const save = async (method: "PUT" | "DELETE") => {
    const controller = ownerRequest.current;
    if (busy || !controller || controller.signal.aborted) return;
    const parsed = privateProfileInputSchema.safeParse(form);
    if (method === "PUT" && !parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "Check your profile."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/me/profile", { method, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), headers: { "Content-Type": "application/json", "X-Keryx-Expected-Wallet": wallet }, ...(method === "PUT" && parsed.success ? { body: JSON.stringify(parsed.data) } : {}) });
      const value = await response.json(); if (!response.ok) throw new Error(value.message ?? "Profile could not be changed.");
      const profile = method === "DELETE" ? null : privateProfileRecordSchema.parse(value.profile);
      if (profile && profile.wallet !== wallet) throw new Error("Profile owner mismatch.");
      if (controller.signal.aborted) return;
      setSnapshot(current => current ? { ...current, profile } : null);
      if (method === "DELETE") setForm(empty);
      setMessage(method === "DELETE" ? "Profile fields deleted. Your research and payment history are retained." : "Private profile saved.");
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Profile could not be changed."); } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <div key={wallet} className="space-y-6">
    <p className="break-all font-mono text-xs text-ink-3">Signed wallet: {wallet}</p>
    {message && <p role="status" className="text-sm text-ink">{message}</p>}
    {!snapshot ? <p className="text-sm text-ink-3">Profile fields are available after this deployment enables the private profile store.</p> : <>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save("PUT"); }}>
        {([ ["displayName", "Display name", 80], ["handle", "Handle", 32], ["bio", "Who I am", 160], ["purpose", "What brings me to Keryx", 160] ] as const).map(([key, label, max]) => <label key={key} className="block text-sm text-ink">{label}<input className="mt-1 block w-full border border-line bg-paper px-3 py-2" value={form[key]} maxLength={max} onChange={event => change(key, event.target.value)} disabled={busy} /></label>)}
        <p className="text-xs text-ink-3">Handles use 3–32 letters, digits or underscores, begin with a letter, and are case-insensitive. Reserved names are unavailable.</p>
        <fieldset className="space-y-3"><legend className="mb-2 text-sm">Links (optional HTTPS profile URLs)</legend>
          {PROFILE_LINK_KINDS.map(kind => <label key={kind} className="block text-sm">{kind === "website" ? "Personal website" : kind}<input type="url" className="mt-1 block w-full border border-line bg-paper px-3 py-2" maxLength={512} value={form.links.find(link => link.kind === kind)?.url ?? ""} disabled={busy} onChange={event => setForm(current => ({ ...current, links: [...current.links.filter(link => link.kind !== kind), ...(event.target.value ? [{ kind, url: event.target.value }] : [])] }))} /></label>)}
        </fieldset>
        <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy} className="border border-ink bg-ink px-4 py-2 text-sm text-paper">{busy ? "Saving…" : "Save private profile"}</button>
          <button type="button" disabled={busy || !snapshot.profile} className="border border-line px-4 py-2 text-sm" onClick={() => { if (window.confirm("Delete your private profile fields and links? Research and payment history will remain.")) void save("DELETE"); }}>Delete profile fields</button></div>
      </form>
      {snapshot.profile?.links.length ? <ul className="space-y-2 text-sm">{snapshot.profile.links.map(link => <li key={link.kind}><a className="break-all underline" href={link.url} target="_blank" rel="noopener noreferrer nofollow">{link.kind}: {link.url}</a></li>)}</ul> : null}
      <section className="border-t border-line pt-5"><h2 className="font-serif text-lg">Recorded activity</h2>
        <p className="mt-2 text-sm">First seen: {snapshot.activity.firstSeenAt ?? "Unknown"} · Attributed dispatches: {snapshot.activity.questions}</p>
        <p className="text-sm">Surfaces recorded: {snapshot.activity.surfacesUsed.join(", ") || "None recorded"}</p>
        <p className="text-sm">Recorded topics: {snapshot.activity.topics === null ? "Unavailable" : snapshot.activity.topics.join(", ") || "None recorded"}</p>
        <p className="text-sm">Creator wallets with recorded settled payments in your runs ({snapshot.activity.network}): {snapshot.activity.creatorsPaid ?? "Unavailable"}</p>
        <p className="mt-2 text-xs text-ink-3">Derived from dispatches attributed to this wallet in this store, including recorded simulations in dispatch counts. Attribution does not establish who funded a run. Anonymous and historical archive activity are excluded. Up to 12 recorded topics are shown. Creator counts require recorded settlement evidence; they do not independently reconcile Circle.</p>
      </section>
    </>}
  </div>;
}
