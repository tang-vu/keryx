"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
          setData(null); setError("Your session has ended. Sign in again to manage sessions.");
          window.dispatchEvent(new Event("keryx:auth"));
        }
        return;
      }
      if (!response.ok) throw new Error("unavailable");
      const result = await response.json() as SessionList;
      if (attempt === revision.current) { setData(result); setError(""); }
    } catch {
      if (attempt === revision.current) setError("Sessions could not be refreshed. Please retry.");
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
      setNotice(id ? "The selected session has been signed out." : "Other sessions have been signed out. This session remains active.");
      await refresh();
    } catch { setError("Sign-out could not be confirmed. Refresh the list and retry."); }
    finally { mutation.current = false; setBusy(false); }
  };

  return <section aria-labelledby="account-sessions-title" className="mt-8 border border-line bg-paper p-5 sm:p-8">
    <h2 id="account-sessions-title" className="font-display text-2xl text-ink">Signed-in sessions</h2>
    <p className="mt-2 text-sm leading-relaxed text-ink-2">Review account access across browsers. Each sign-in creates a session; device names and locations are not collected.</p>
    <p className="mt-2 text-sm leading-relaxed text-ink-2">Signing out ends account access. It does not cancel accepted research jobs or already signed payment authorizations.</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={() => { void refresh(); }}>Refresh sessions</button>
      <button className={button} disabled={busy || !data || (!data.truncated && !data.sessions.some(row => !row.current))} onClick={() => { void revoke(); }}>Sign out all other sessions</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-seal">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-paid">{notice}</p>}
    {!data && !error && <p role="status" className="mt-4 text-sm text-ink-2">Loading sessions…</p>}
    {data?.truncated && <p className="mt-3 text-sm text-ink-2">Showing the 100 newest sessions. Sign out all other sessions also includes older sessions.</p>}
    <ul className="mt-4 divide-y divide-line">
      {data?.sessions.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0 text-sm">
          <p className="font-medium text-ink">{row.current ? "This browser session" : `Session ${row.id.slice(0, 8)}`}</p>
          <p className="mt-1 text-ink-2">Signed in {date(row.issuedAt)}</p>
          <p className="text-ink-2">Expires {date(row.expiresAt)}</p>
        </div>
        {!row.current && <button className={button} disabled={busy} onClick={() => { void revoke(row.id); }} aria-label={`Sign out session ${row.id.slice(0, 8)}`}>Sign out</button>}
      </li>)}
    </ul>
  </section>;
}
