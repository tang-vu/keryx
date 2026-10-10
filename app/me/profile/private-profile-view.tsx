"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { PROFILE_LINK_KINDS, privateProfileInputSchema, privateProfileSnapshotSchema, privateProfileRecordSchema, type PrivateProfileInput, type PrivateProfileSnapshot } from "@/lib/profiles/private-profile";
import { VerifiedIdentityPanel } from "./verified-identity-panel";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";

const copy = createMessages("en");
const richCopy = createRichMessages("en");


const empty: PrivateProfileInput = { displayName: "", handle: "", bio: "", purpose: "", links: [] };
export function PrivateProfileView() {
  const { session } = useSiweAuth();
  if (session === undefined) return <p role="status">{copy("privateProfile.checkingSignIn")}</p>;
  if (!session) return <p>{richCopy("privateProfile.signInInstruction", { signInLink: <Link className="underline" href="/connect">{copy("privateProfile.signIn")}</Link> })}</p>;
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
    fetch("/api/me/profile", { cache: "no-store", headers: { "X-Keryx-Expected-Wallet": wallet }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.message ?? copy("privateProfile.accessUnavailable"));
      const parsed = privateProfileSnapshotSchema.parse(value);
      if (parsed.profile && parsed.profile.wallet !== wallet) throw new Error(copy("privateProfile.ownerMismatch"));
      if (!controller.signal.aborted) { setSnapshot(parsed); setForm(parsed.profile ? { displayName: parsed.profile.displayName, handle: parsed.profile.handle, bio: parsed.profile.bio, purpose: parsed.profile.purpose, links: parsed.profile.links } : empty); setMessage(""); }
    }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : copy("privateProfile.unavailable")); });
    return () => controller.abort();
  }, [wallet]);
  const change = (key: "displayName" | "handle" | "bio" | "purpose", value: string) => setForm(current => ({ ...current, [key]: value }));
  const save = async (method: "PUT" | "DELETE") => {
    const controller = ownerRequest.current;
    if (busy || !controller || controller.signal.aborted) return;
    const parsed = privateProfileInputSchema.safeParse(form);
    if (method === "PUT" && !parsed.success) { setMessage(parsed.error.issues[0]?.message ?? copy("privateProfile.checkFields")); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/me/profile", { method, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), headers: { "Content-Type": "application/json", "X-Keryx-Expected-Wallet": wallet }, ...(method === "PUT" && parsed.success ? { body: JSON.stringify(parsed.data) } : {}) });
      const value = await response.json(); if (!response.ok) throw new Error(value.message ?? copy("privateProfile.changeFailed"));
      const profile = method === "DELETE" ? null : privateProfileRecordSchema.parse(value.profile);
      if (profile && profile.wallet !== wallet) throw new Error(copy("privateProfile.ownerMismatch"));
      if (controller.signal.aborted) return;
      setSnapshot(current => current ? { ...current, profile } : null);
      if (method === "DELETE") setForm(empty);
      setMessage(method === "DELETE" ? copy("privateProfile.deleted") : copy("privateProfile.saved"));
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : copy("privateProfile.changeFailed")); } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <div key={wallet} className="space-y-6">
    <p className="break-all font-mono text-xs text-ink-3">{richCopy("privateProfile.signedWallet", { wallet: wallet })}</p>
    {message && <p role="status" className="text-sm text-ink">{message}</p>}
    {!snapshot ? <p className="text-sm text-ink-3">{copy("privateProfile.storeUnavailable")}</p> : <>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save("PUT"); }}>
        {([ ["displayName", copy("privateProfile.displayName"), 80], ["handle", copy("privateProfile.handle"), 32], ["bio", copy("privateProfile.bio"), 160], ["purpose", copy("privateProfile.purpose"), 160] ] as const).map(([key, label, max]) => <label key={key} className="block text-sm text-ink">{label}<input className="mt-1 block w-full border border-line bg-paper px-3 py-2" value={form[key]} maxLength={max} onChange={event => change(key, event.target.value)} disabled={busy} /></label>)}
        <p className="text-xs text-ink-3">{copy("privateProfile.handleRules")}</p>
        <fieldset className="space-y-3"><legend className="mb-2 text-sm">{copy("privateProfile.linksLegend")}</legend>
          {PROFILE_LINK_KINDS.map(kind => <label key={kind} className="block text-sm">{kind === "website" ? copy("privateProfile.website") : kind}<input type="url" className="mt-1 block w-full border border-line bg-paper px-3 py-2" maxLength={512} value={form.links.find(link => link.kind === kind)?.url ?? ""} disabled={busy} onChange={event => setForm(current => ({ ...current, links: [...current.links.filter(link => link.kind !== kind), ...(event.target.value ? [{ kind, url: event.target.value }] : [])] }))} /></label>)}
        </fieldset>
        <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy} className="border border-ink bg-ink px-4 py-2 text-sm text-paper">{busy ? copy("privateProfile.saving") : copy("privateProfile.save")}</button>
          <button type="button" disabled={busy || !snapshot.profile} className="border border-line px-4 py-2 text-sm" onClick={() => { if (window.confirm(copy("privateProfile.deleteConfirmation"))) void save("DELETE"); }}>{copy("privateProfile.delete")}</button></div>
      </form>
      {snapshot.profile?.links.length ? <ul className="space-y-2 text-sm">{snapshot.profile.links.map(link => <li key={link.kind}><a className="break-all underline" href={link.url} target="_blank" rel="noopener noreferrer nofollow">{link.kind}: {link.url}</a></li>)}</ul> : null}
      <VerifiedIdentityPanel key={wallet} wallet={wallet} saved={!!snapshot.profile} />
      <section className="border-t border-line pt-5"><h2 className="font-serif text-lg">{copy("privateProfile.activity")}</h2>
        <p className="mt-2 text-sm">{richCopy("privateProfile.firstSeenAndDispatches", { firstSeen: snapshot.activity.firstSeenAt ?? copy("privateProfile.unknown"), questions: snapshot.activity.questions })}</p>
        <p className="text-sm">{richCopy("privateProfile.surfacesRecorded", { surfaces: snapshot.activity.surfacesUsed.join(", ") || copy("privateProfile.noneRecorded") })}</p>
        <p className="text-sm">{richCopy("privateProfile.topicsRecorded", { topics: snapshot.activity.topics === null ? copy("privateProfile.unavailableActivity") : snapshot.activity.topics.join(", ") || copy("privateProfile.noneRecorded") })}</p>
        <p className="text-sm">{richCopy("privateProfile.creatorsPaid", { network: snapshot.activity.network, creators: snapshot.activity.creatorsPaid ?? copy("privateProfile.unavailableActivity") })}</p>
        <p className="mt-2 text-xs text-ink-3">{copy("privateProfile.activityBoundary")}</p>
      </section>
    </>}
  </div>;
}
