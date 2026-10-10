"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");

interface SessionRow { id: string; issuedAt: number; expiresAt: number; current: boolean }
interface SessionList { sessions: SessionRow[]; truncated: boolean }
const button = "border border-line px-3 py-2 text-sm text-ink hover:border-ink disabled:opacity-50 disabled:cursor-wait";
const date = (ms: number) => new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Parent keys this view by account so account changes cannot retain another wallet's list. */
export function AccountSessions() {
  const [data, setData] = useState<SessionList | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const mutation = useRef(false);
  const refresh = useCallback(async () => {
    const attempt = ++revision.current;
    try {
      const response = await fetch("/api/auth/sessions", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (response.status === 401) {
        if (attempt === revision.current) {
          setData(null); setError(message("accountSessions.ended"));
          window.dispatchEvent(new Event("keryx:auth"));
        }
        return;
      }
      if (!response.ok) throw new Error("unavailable");
      const result = await response.json() as SessionList;
      if (attempt === revision.current) { setData(result); setError(""); }
    } catch {
      if (attempt === revision.current) setError(message("accountSessions.refreshFailed"));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => { if (!mutation.current) void refresh(); };
    window.addEventListener("focus", focus);
    return () => { revision.current++; window.removeEventListener("focus", focus); };
  }, [refresh]);

  const revoke = async (id?: string) => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setNotice(""); setError(""); revision.current++;
    try {
      const response = await fetch(`/api/auth/sessions${id ? `/${id}` : ""}`, { method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok || (await response.json()).ok !== true) throw new Error("unconfirmed");
      setNotice(message(id ? "accountSessions.selectedSignedOut" : "accountSessions.othersSignedOut"));
      await refresh();
    } catch { setError(message("accountSessions.signOutUnconfirmed")); }
    finally { mutation.current = false; setBusy(false); }
  };

  return <section aria-labelledby="account-sessions-title" className="mt-8 border border-line bg-paper p-5 sm:p-8">
    <h2 id="account-sessions-title" className="font-display text-2xl text-ink">{message("accountSessions.title")}</h2>
    <p className="mt-2 text-sm leading-relaxed text-ink-2">{message("accountSessions.introduction")}</p>
    <p className="mt-2 text-sm leading-relaxed text-ink-2">{message("accountSessions.signOutBoundary")}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={() => { void refresh(); }}>{message("accountSessions.refresh")}</button>
      <button className={button} disabled={busy || !data || (!data.truncated && !data.sessions.some(row => !row.current))} onClick={() => { void revoke(); }}>{message("accountSessions.signOutOthers")}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-seal">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-paid">{notice}</p>}
    {!data && !error && <p role="status" className="mt-4 text-sm text-ink-2">{message("accountSessions.loading")}</p>}
    {data?.truncated && <p className="mt-3 text-sm text-ink-2">{message("accountSessions.truncated")}</p>}
    <ul className="mt-4 divide-y divide-line">
      {data?.sessions.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0 text-sm">
          <p className="font-medium text-ink">{row.current ? message("accountSessions.current") : message("accountSessions.session", { id: row.id.slice(0, 8) })}</p>
          <p className="mt-1 text-ink-2">{message("accountSessions.issuedAt", { date: date(row.issuedAt) })}</p>
          <p className="text-ink-2">{message("accountSessions.expiresAt", { date: date(row.expiresAt) })}</p>
        </div>
        {!row.current && <button className={button} disabled={busy} onClick={() => { void revoke(row.id); }} aria-label={message("accountSessions.signOutLabel", { id: row.id.slice(0, 8) })}>{message("account.signOut")}</button>}
      </li>)}
    </ul>
  </section>;
}
