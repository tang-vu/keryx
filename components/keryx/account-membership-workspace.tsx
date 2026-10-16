"use client";

import { useEffect, useRef, useState } from "react";
import { accountMembershipCopy as copy } from "@/locales/en/account-membership";
import { accountIdSchema, canonicalWalletSchema, digestSchema, membershipSchema, preconditionSchema, type AccountPrecondition,
  type IssuedMembershipChallenge, type Membership } from "@/lib/accounts/contracts";
import { useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_copy = copy;


const accountConsent = { version: 1, privateAccount: true, shareOwnedHistory: true } as const;
const linkConsent = { version: 1, sharePastAndFutureOwnedHistory: true, walletAuthorityStaysSeparate: true } as const;
const messages: Record<string, string> = {
  account_unavailable: "Private account membership is unavailable on this deployment.",
  account_unauthenticated: "Sign in again, then reload your account.",
  interactive_account_session_required: "Sign in through the website to manage your account.",
  account_changed: "Your account changed. Reload before continuing.",
  wallet_unavailable: "That wallet cannot be linked. No account was changed.",
  account_full: "An account can contain up to eight wallets.",
  last_credential: "Keep a verified alternative login before removing this wallet.",
  invalid_membership_proof: "The wallet proof is invalid, expired or already used. Reload and start a fresh explicit link.",
};
export function AccountMembershipWorkspace() {
  const copy = useUiCopy("account-membership", uiEnglish_copy);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [sessionWallet, setSessionWallet] = useState<string | null>(null);
  const [offer, setOffer] = useState<AccountPrecondition | null>(null);
  const [available, setAvailable] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [accountAccepted, setAccountAccepted] = useState(false), [linkAccepted, setLinkAccepted] = useState(false), [unlinkAccepted, setUnlinkAccepted] = useState(false);
  const [wallet, setWallet] = useState(""), [signature, setSignature] = useState("");
  const [pending, setPending] = useState<IssuedMembershipChallenge | null>(null);
  const request = useRef<AbortController | null>(null), epoch = useRef(0);
  function clear() {
    request.current?.abort(); epoch.current++; setMembership(null); setOffer(null); setPending(null); setSignature("");
    setAvailable(false); setBusy(false); setSessionWallet(null); setAccountAccepted(false); setLinkAccepted(false); setUnlinkAccepted(false);
  }
  async function load() {
    clear(); setBusy(true); setMessage(""); const thisEpoch = epoch.current, controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch("/api/account/membership", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "account_unavailable");
      const current = data.membership === null ? null : membershipSchema.parse(data.membership);
      const resumeOffer = data.offer === null ? null : preconditionSchema.parse(data.offer);
      const currentWallet = canonicalWalletSchema.parse(data.wallet);
      if (epoch.current !== thisEpoch) return;
      setMembership(current); setSessionWallet(currentWallet); setOffer(resumeOffer); setAvailable(true);
    } catch (error) {
      if (epoch.current === thisEpoch) setMessage(messages[error instanceof Error ? error.message : ""] || "Account state is unconfirmed. Reload before continuing.");
    } finally { if (epoch.current === thisEpoch) setBusy(false); }
  }
  useEffect(() => {
    void load();
    const hide = () => { if (document.visibilityState === "hidden") { clear(); setBusy(false); setMessage("Reload your account before continuing."); } };
    document.addEventListener("visibilitychange", hide);
    return () => { request.current?.abort(); epoch.current++; document.removeEventListener("visibilitychange", hide); };
    // Initial load only. Membership writes never run as an effect or retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function action(body: Record<string, unknown>) {
    if (!available || !sessionWallet) return;
    request.current?.abort(); setBusy(true); setMessage(""); const thisEpoch = ++epoch.current, controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch("/api/account/membership", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Keryx-Expected-Wallet": sessionWallet }, body: JSON.stringify(body), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "account_unavailable");
      if (epoch.current !== thisEpoch) return;
      if (body.action === "prepare-create" || body.action === "prepare-link") {
        const { challengeSchema } = await import("@/lib/accounts/contracts");
        const challenge = challengeSchema.parse(data.challenge), nonce = digestSchema.parse(data.nonce);
        if (typeof data.message !== "string" || data.message.length > 8192 || challenge.expiresAt <= Date.now()) throw new Error("invalid_membership_proof");
        if (epoch.current !== thisEpoch) return;
        setPending({ challenge, nonce, message: data.message }); setSignature("");
      } else {
        setPending(null); setSignature(""); setLinkAccepted(false); setUnlinkAccepted(false);
        if (data.revoked) { clear(); setMessage("Account access for this sign-in was revoked. Sign in again to resume."); }
        else {
          const current = data.membership === null ? null : membershipSchema.parse(data.membership);
          setMembership(current); setOffer(current ? { accountId: accountIdSchema.parse(current.accountId), revision: current.revision } : null);
          if (!current) { setAvailable(false); setAccountAccepted(false); }
          setMessage(current ? "Account membership saved." : "Wallet unlinked. Reload or sign in again to continue.");
        }
      }
    } catch (error) {
      if (epoch.current === thisEpoch) {
        clear(); setMessage(messages[error instanceof Error ? error.message : ""] || "The result is unconfirmed. Reload to check committed state; no automatic retry was made."); setBusy(false);
      }
    } finally { if (epoch.current === thisEpoch) setBusy(false); }
  }
  const expected = membership ? { accountId: membership.accountId, revision: membership.revision } : offer;
  return <section className="mx-auto max-w-3xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">{copy.title}</h1>
    <p>{copy.authority}</p>
    <p>{copy.walletFree}</p>
    <button type="button" disabled={busy} onClick={() => void load()} className="rounded border px-4 py-2">{copy.reload}</button>
    <p role="status" aria-live="polite">{busy ? copy.checking : message}</p>
    {sessionWallet && <p className="break-all">{copy.currentWallet} {sessionWallet}</p>}
    {available && !membership && <div className="space-y-3">
      <label className="block"><input type="checkbox" checked={accountAccepted} onChange={e => setAccountAccepted(e.target.checked)} /> {copy.consentPrefix} {offer ? copy.accessing : copy.creating} {copy.consentSuffix}</label>
      <button type="button" disabled={busy || !accountAccepted || !!pending} onClick={() => void action(offer
        ? { action: "resume", expected: offer, consent: accountConsent } : { action: "prepare-create", consent: accountConsent })} className="rounded border px-4 py-2">{offer ? copy.resume : copy.reviewCreate}</button>
    </div>}
    {membership && <div className="space-y-4">
      <p className="break-all">{copy.account} {membership.accountId} {copy.revision} {membership.revision}</p>
      <label className="block"><input type="checkbox" checked={unlinkAccepted} onChange={e => setUnlinkAccepted(e.target.checked)} /> {copy.unlinkConsent}</label>
      <ul className="space-y-2">{membership.members.map(member => <li key={member.generation} className="break-all">
        {member.wallet} <button type="button" disabled={busy || !unlinkAccepted || !!pending} onClick={() => void action({ action: "unlink", expected, wallet: member.wallet, generation: member.generation, consent: true })} className="rounded border px-2 py-1">{copy.unlink}</button>
      </li>)}</ul>
      <label className="block">{copy.walletToProve} <input className="ml-2 rounded border p-2" value={wallet} onChange={e => setWallet(e.target.value)} maxLength={42} disabled={busy || !!pending} placeholder={copy.walletPlaceholder} /></label>
      <label className="block"><input type="checkbox" checked={linkAccepted} onChange={e => setLinkAccepted(e.target.checked)} /> {copy.linkConsent}</label>
      <button type="button" disabled={busy || !linkAccepted || !!pending || membership.members.length >= 8 || !/^0x[a-fA-F0-9]{40}$/.test(wallet)} onClick={() => void action({ action: "prepare-link", expected, wallet, consent: linkConsent })} className="rounded border px-4 py-2">{copy.reviewWallet}</button>
      <button type="button" disabled={busy || !!pending} onClick={() => void action({ action: "revoke-session", expected, consent: true })} className="ml-2 rounded border px-4 py-2">{copy.revoke}</button>
    </div>}
    {pending && <div className="space-y-3 rounded border p-4">
      <p>{copy.confirmIntent}</p>
      <pre className="whitespace-pre-wrap break-all text-xs">{pending.message}</pre>
      {pending.challenge.purpose === "link-wallet" && <>
        <p>{copy.targetSignatureHelp}</p>
        <label className="block">{copy.targetSignature} <textarea className="block w-full rounded border p-2" value={signature} onChange={e => setSignature(e.target.value)} maxLength={132} disabled={busy} /></label>
      </>}
      <button type="button" disabled={busy || pending.challenge.expiresAt <= Date.now() || (pending.challenge.purpose === "link-wallet" ? !linkAccepted || !/^0x[a-fA-F0-9]{130}$/.test(signature) : !accountAccepted)} onClick={() => void action(pending.challenge.purpose === "link-wallet"
        ? { action: "complete-link", nonce: pending.nonce, signature, consent: linkConsent }
        : { action: "complete-create", nonce: pending.nonce, consent: accountConsent })} className="rounded border px-4 py-2">{pending.challenge.purpose === "link-wallet" ? copy.confirmLink : copy.confirmCreate}</button>
      <button type="button" disabled={busy} onClick={() => void load()} className="ml-2 rounded border px-4 py-2">{copy.cancel}</button>
    </div>}
  </section>;
}
