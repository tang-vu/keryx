"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatRecipient } from "@/lib/chat-accounts/contracts";
import { chatAccountMessages } from "@/locales/en/chat-accounts";

interface Account { accountId: string; revision: number }
interface Preview { recipient: ChatRecipient; account: Account; expiresAt: number; consentProof: string }
interface ListedLink extends ChatRecipient { linkedAt: number }

export function ChatAccountLinks() {
  // Credential stays in component memory, never query/server props/local storage.
  const token = useRef<string | null>(null), started = useRef(false);
  const epoch = useRef(0), pending = useRef<AbortController | null>(null), mounted = useRef(false);
  const established = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null), [account, setAccount] = useState<Account | null>(null);
  const [links, setLinks] = useState<ListedLink[]>([]), [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState(chatAccountMessages["notice.initial"] as string), [busy, setBusy] = useState(false);
  function invalidate(clearToken: boolean) {
    epoch.current++; pending.current?.abort(); pending.current = null;
    if (clearToken) token.current = null;
    setAccount(null); setLinks([]); setPreview(null); setConsent(false); setBusy(false);
  }
  function begin() {
    epoch.current++; pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setConsent(false); setPreview(null);
    return { epoch: epoch.current, controller };
  }
  type Attempt = ReturnType<typeof begin>;
  const current = (attempt: Attempt) => mounted.current && epoch.current === attempt.epoch && !attempt.controller.signal.aborted;
  async function request(attempt: Attempt, path: string, body?: unknown) {
    if (!current(attempt)) throw new Error("Stale chat request");
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      signal: attempt.controller.signal, mode: "same-origin", redirect: "error",
      cache: "no-store", referrerPolicy: "no-referrer", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    if (!current(attempt)) throw new Error("Stale chat request");
    if (response.status === 401) throw new Error(chatAccountMessages["error.signIn"]);
    if (response.status === 409) throw new Error(chatAccountMessages["error.accountChanged"]);
    if (response.status === 410) { token.current = null; throw new Error(chatAccountMessages["error.expired"]); }
    if (!response.ok) throw new Error(chatAccountMessages["error.unconfirmed"]);
    const data = await response.json();
    if (!current(attempt)) throw new Error("Stale chat response");
    return data;
  }
  function failed(attempt: Attempt, error: unknown) {
    if (!current(attempt)) return;
    invalidate(established.current);
    setNotice(error instanceof Error ? error.message : chatAccountMessages["error.unavailable"]);
  }
  async function load() {
    const attempt = begin(); setAccount(null); setLinks([]);
    try {
      const data = await request(attempt, "/api/me/chat-accounts");
      if (!current(attempt)) return;
      established.current = true; setAccount(data.account); setLinks(data.links);
      if (token.current) {
        const next = await request(attempt, "/api/me/chat-accounts", { action: "preview", token: token.current });
        if (!current(attempt)) return;
        setPreview(next); setAccount(next.account); setNotice(chatAccountMessages["notice.preview"]);
      } else setNotice(chatAccountMessages["notice.listed"]);
    } catch (error) { failed(attempt, error); }
    finally { if (current(attempt)) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      const params = new URLSearchParams(window.location.hash.slice(1));
      const candidate = params.getAll("token");
      // Remove before any request or navigation. No credential reaches a referrer.
      window.history.replaceState(null, "", window.location.pathname);
      if (candidate.length === 1 && [...params.keys()].length === 1 && /^[a-f0-9]{64}$/.test(candidate[0])) token.current = candidate[0];
    }
    const changed = (event?: Event) => {
      const signedOut = event instanceof CustomEvent && event.detail === "signed-out";
      // Retain only an initial, as-yet unauthenticated/enrolling credential for
      // deliberate in-place sign-in. An established consent session never survives.
      invalidate(signedOut || established.current);
      setNotice(chatAccountMessages["notice.authChanged"]);
      if (!signedOut) void load();
    };
    const departed = () => { invalidate(true); };
    window.addEventListener("keryx:auth", changed); window.addEventListener("focus", changed);
    window.addEventListener("pagehide", departed);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("keryx-auth-v1");
      channel.onmessage = event => changed(new CustomEvent("keryx:auth", { detail: event.data }));
    } catch { /* Direct focus invalidation also handles unavailable messaging. */ }
    void load();
    return () => {
      mounted.current = false; epoch.current++; pending.current?.abort(); pending.current = null;
      window.removeEventListener("keryx:auth", changed); window.removeEventListener("focus", changed);
      window.removeEventListener("pagehide", departed); channel?.close();
      // React effect replay immediately remounts; a real unmount destroys the
      // credential. No response may publish during either cleanup interval.
      queueMicrotask(() => { if (!mounted.current) token.current = null; });
    };
    // Initial fragment intake only; no automatic completion or background polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function confirm() {
    if (!preview || !token.current || !consent || busy) return;
    const attempt = begin();
    try {
      await request(attempt, "/api/me/chat-accounts/complete", { token: token.current, accountId: preview.account.accountId,
        consentProof: preview.consentProof,
        revision: preview.account.revision, consent: { version: 1, linkFutureRuns: true, financialAuthorityUnchanged: true }, pastRunIds: [] });
      if (!current(attempt)) return;
      token.current = null; setPreview(null); setConsent(false);
      const data = await request(attempt, "/api/me/chat-accounts");
      if (!current(attempt)) return;
      setLinks(data.links); setAccount(data.account);
      setNotice(chatAccountMessages["notice.linked"]);
    } catch (error) { failed(attempt, error); }
    finally { if (current(attempt)) setBusy(false); }
  }
  async function unlink(recipient: ListedLink) {
    if (!account || busy) return;
    const attempt = begin();
    try {
      const { platform, scope, userId, channel } = recipient;
      await request(attempt, "/api/me/chat-accounts", { action: "unlink", recipient: { platform, scope, userId, channel }, ...account });
      if (!current(attempt)) return;
      const data = await request(attempt, "/api/me/chat-accounts");
      if (!current(attempt)) return;
      setLinks(data.links); setAccount(data.account);
      setNotice(chatAccountMessages["notice.unlinked"]);
    } catch (error) { failed(attempt, error); }
    finally { if (current(attempt)) setBusy(false); }
  }
  return <section className="space-y-4" aria-label={chatAccountMessages["consent.sectionLabel"]}>
    <p role="status">{notice}</p>
    <button type="button" onClick={() => void load()} disabled={busy} className="rounded border px-4 py-2">{chatAccountMessages["action.load"]}</button>
    <p>{chatAccountMessages["account.enrollPrompt"]}<a href="/account" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="underline">{chatAccountMessages["account.openWorkspace"]}</a>{chatAccountMessages["account.returnInstructions"]}</p>
    {preview && <div className="rounded border p-4 space-y-3">
      <p>{chatAccountMessages["preview.chatLabel"]}{preview.recipient.platform} / {preview.recipient.scope} / {preview.recipient.userId}</p>
      <p className="break-all">{chatAccountMessages["preview.accountLabel"]}{preview.account.accountId}</p>
      <p>{chatAccountMessages["preview.expiresLabel"]}{new Date(preview.expiresAt).toLocaleTimeString()}</p>
      <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />
        <span>{chatAccountMessages["consent.statement"]}</span></label>
      <button type="button" onClick={() => void confirm()} disabled={!consent || busy} className="rounded border px-4 py-2">{chatAccountMessages["action.confirm"]}</button>
    </div>}
    <p>{chatAccountMessages["history.unavailable"]}</p>
    <ul className="space-y-2">{links.map(link => <li key={`${link.platform}:${link.scope}:${link.userId}`} className="rounded border p-3">
      {link.platform} / {link.scope} / {link.userId} <button type="button" onClick={() => void unlink(link)} disabled={busy} className="ml-3 underline">{chatAccountMessages["action.unlink"]}</button>
    </li>)}</ul>
  </section>;
}
