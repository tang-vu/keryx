"use client";
import { useEffect, useRef, useState } from "react";
import { identityCopy as copy } from "@/locales/en/profile-identities";
import { IDENTITY_PROVIDERS, identitySnapshotSchema, identityUrl, type IdentityProvider, type IdentitySnapshot } from "@/lib/profiles/verified-identities";

export function VerifiedIdentityPanel(props: { wallet: string; saved: boolean }) {
  return <IdentityPanelSession key={`${props.wallet}:${props.saved ? "saved" : "unsaved"}`} {...props} />;
}
/** Saved-profile deletion/recreation is a new lifecycle even when the wallet stays the same. */
function IdentityPanelSession({ wallet, saved }: { wallet: string; saved: boolean }) {
  const [snapshot, setSnapshot] = useState<IdentitySnapshot | null>(null), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const owner = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); owner.current = controller;
    const notice = new URL(window.location.href).searchParams.get("identity");
    if (notice) {
      const location = new URL(window.location.href); location.searchParams.delete("identity");
      window.history.replaceState(window.history.state, "", location.pathname + location.search + location.hash);
    }
    fetch("/api/me/profile/identities", { cache: "no-store", headers: { "X-Keryx-Expected-Wallet": wallet },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async response => {
      if (!response.ok) throw new Error(copy.unavailable);
      const value = identitySnapshotSchema.parse(await response.json());
      if (value.wallet !== wallet) throw new Error(copy.changed);
      if (!controller.signal.aborted) {
        setSnapshot(value);
        if (notice) setMessage(notice === "verified" ? copy.verified : notice === "conflict" ? copy.conflict : copy.failed);
      }
    }).catch(() => { if (!controller.signal.aborted) { setSnapshot(null); setMessage(copy.unavailable); } });
    return () => controller.abort();
  }, [wallet, saved]);
  const act = async (provider: IdentityProvider, unlink: boolean) => {
    const controller = owner.current;
    if (!controller || controller.signal.aborted || busy || !saved) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/me/profile/identities/${provider}${unlink ? "" : "/start"}`, {
        method: unlink ? "DELETE" : "POST", headers: { "X-Keryx-Expected-Wallet": wallet },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error === "profile_owner_changed" ? copy.changed : copy.unavailable);
      if (controller.signal.aborted) return;
      if (unlink) {
        if (value.unlinked !== true || Object.keys(value).length !== 1) throw new Error(copy.invalid);
        setSnapshot(current => current ? { ...current, identities: current.identities.filter(identity => identity.provider !== provider) } : null);
        setMessage(copy.unlinked);
      } else {
        const url = new URL(value.authorizationUrl);
        // Even a malformed API response cannot navigate to a request-selected site.
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
          || url.hostname !== (provider === "github" ? "github.com" : "orcid.org")
          || url.pathname !== (provider === "github" ? "/login/oauth/authorize" : "/oauth/authorize")) throw new Error(copy.invalid);
        window.location.assign(url.href);
      }
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : copy.failed); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <section className="space-y-3 border-t border-line pt-5">
    <h2 className="font-serif text-lg">{copy.title}</h2>
    <p className="text-sm">{copy.description}</p><p className="text-xs text-ink-3">{copy.asserted}</p>
    {!saved && <p className="text-sm">{copy.saveFirst}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {saved && snapshot?.identities.map(identity => <div key={identity.provider} className="flex flex-wrap items-center gap-3 text-sm">
      <a className="break-all underline" href={identityUrl(identity)} target="_blank" rel="noopener noreferrer nofollow">{identity.provider}: {identity.label || identity.externalId}</a>
      <span className="text-xs text-ink-3">{copy.date(identity.verifiedAt)}</span>
      <button type="button" disabled={busy || !saved} className="border border-line px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void act(identity.provider, true)}>{copy.unlink}</button>
    </div>)}
    <div className="flex flex-wrap gap-3">{IDENTITY_PROVIDERS.map(provider => <button key={provider} type="button" disabled={busy || !saved || !snapshot}
      className="border border-line px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void act(provider, false)}>
      {busy ? copy.busy : provider === "orcid" ? copy.verifyOrcid : copy.verifyGithub}
    </button>)}</div>
    <p className="text-xs text-ink-3">{copy.scope}</p><p className="text-xs text-ink-3">{copy.ownership}</p>
  </section>;
}
