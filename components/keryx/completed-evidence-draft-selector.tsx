"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CompletedEvidenceDraftImport, type CompletedEvidenceDraftImportProps } from "./completed-evidence-draft-import";
import { evidenceDraftWorkspace } from "@/lib/research/evidence-draft";
import type { LiteratureWorkspace } from "@/lib/papers/literature-workspace";
import type { CompletedEvidenceDraftSelectionPacket } from "@/lib/research/completed-evidence-draft-selection";
import { completedEvidenceDraftSelectionCopy as copy } from "@/locales/en/completed-evidence-draft-selection";
import { useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_copy = copy;


const field = "mt-2 block w-full min-w-0 rounded-none border border-line bg-paper px-3 py-2 font-serif text-sm text-ink";
const button = "inline-flex min-h-11 items-center border border-ink px-3 py-2 font-mono text-xs text-ink disabled:opacity-50";
const ownerPattern = /^0x[a-f0-9]{40}$/;
const jobPattern = /^prv_[a-f0-9]{64}$/;
async function readJson(response: Response, limit: number) {
  if (!response.body) throw new Error();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((size += value.byteLength) > limit) throw new Error();
      chunks.push(value);
    }
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Mounting and auth-change notifications perform no reads. Session lookup and
 * owner-bound metadata lookup happen only on the user's explicit read action. */
export function CompletedEvidenceDraftSelector({ workspace, onImport, disabled = false }: {
  workspace: LiteratureWorkspace; onImport: CompletedEvidenceDraftImportProps["onImport"]; disabled?: boolean;
}) {
  const copy = useUiCopy("completed-evidence-draft-selection", uiEnglish_copy);
  const [id, setId] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState<string>("");
  const [bound, setBound] = useState<{ key: string; revision: number; packet: CompletedEvidenceDraftSelectionPacket } | null>(null);
  const pending = useRef<AbortController | null>(null), revision = useRef(0), mounted = useRef(false);
  const includedWorkspace = evidenceDraftWorkspace(workspace);
  const key = JSON.stringify([id, includedWorkspace, disabled]);
  const latest = useRef({ key, onImport });
  useLayoutEffect(() => { latest.current = { key, onImport }; }, [key, onImport]);
  const invalidate = useCallback(() => {
    revision.current++; pending.current?.abort(); pending.current = null;
    setBound(null); setBusy(false);
  }, []);
  useLayoutEffect(() => { invalidate(); setMessage(""); }, [key, invalidate]);
  useEffect(() => {
    mounted.current = true;
    const changed = () => { invalidate(); setMessage(copy.changed); };
    window.addEventListener("keryx:auth", changed);
    // Focus invalidates a formerly selected account without reading/polling it.
    window.addEventListener("focus", changed);
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("keryx-auth-v1"); channel.onmessage = changed; } catch { /* Window notifications remain. */ }
    return () => {
      mounted.current = false; revision.current++; pending.current?.abort();
      window.removeEventListener("keryx:auth", changed); window.removeEventListener("focus", changed); channel?.close();
    };
  }, [invalidate]);

  async function readSelection() {
    if (pending.current || disabled) return;
    if (!jobPattern.test(id) || !includedWorkspace.entries.length) { setMessage(copy.invalid); return; }
    const capturedKey = key, attempt = ++revision.current, controller = new AbortController();
    pending.current = controller; setBound(null); setBusy(true); setMessage("");
    const current = () => mounted.current && !controller.signal.aborted && latest.current.key === capturedKey && revision.current === attempt;
    const timer = setTimeout(() => {
      controller.abort();
      if (mounted.current && latest.current.key === capturedKey && revision.current === attempt) {
        if (pending.current === controller) pending.current = null;
        setBusy(false); setMessage(copy.timedOut);
      }
    }, 15000);
    try {
      const options = { credentials: "same-origin" as const, cache: "no-store" as const, redirect: "error" as const, signal: controller.signal };
      const auth = await fetch("/api/auth/session", options);
      if (!current()) return;
      if (!auth.ok) { setMessage(auth.status === 401 ? copy.signIn : copy.storage); return; }
      const session = (await readJson(auth, 4096))?.session;
      if (!current()) return;
      const wallet = typeof session?.address === "string" ? session.address.toLowerCase() : "";
      if (!ownerPattern.test(wallet) || /^0x0{40}$/.test(wallet)) { setMessage(copy.signIn); return; }
      const response = await fetch("/api/research/evidence-draft/completed-read/selection", { ...options,
        method: "POST", headers: { "Content-Type": "application/json", "X-Keryx-Expected-Owner": wallet },
        body: JSON.stringify({ version: 1, id, workspace: includedWorkspace }),
      });
      if (!current()) return;
      if (!response.ok) { setMessage(response.status === 503 ? copy.storage : response.status === 401 ? copy.signIn
        : response.status === 403 ? copy.changed : copy.unavailable); return; }
      const packet = await readJson(response, 65536) as CompletedEvidenceDraftSelectionPacket;
      if (!current()) return;
      const selection = packet.selection;
      if (packet.format !== "completed-evidence-draft-selection-v1" || packet.wallet !== wallet
        || packet.capability !== "owned-private-completed-read-v1" || typeof packet.baseUrl !== "string"
        || new URL(packet.baseUrl).origin !== window.location.origin || typeof packet.network !== "string"
        || !packet.network.length || packet.network.length > 80 || !selection || selection.id !== id
        || typeof selection.savedAt !== "string" || !Number.isFinite(Date.parse(selection.savedAt))
        || !/^sha256:[a-f0-9]{64}$/.test(selection.snapshotSha256) || typeof selection.question !== "string"
        || !selection.question.length || selection.question.length > 4000 || !Number.isFinite(selection.budget)
        || selection.budget <= 0 || selection.budget > 0.5 || !["quick", "deep"].includes(selection.researchMode)
        || !Array.isArray(selection.sources) || !selection.sources.length || selection.sources.length > 50
        || new Set(selection.sources.map(row => row.itemUrl)).size !== selection.sources.length
        || selection.sources.some(row => !row || ![row.sourceId, row.itemId, row.contentVersion].every(value => typeof value === "string" && value.length > 0 && value.length <= 200)
          || !includedWorkspace.entries.some(entry => entry.paper.url === row.itemUrl))) throw new Error();
      setBound({ key: capturedKey, revision: attempt, packet }); setMessage(copy.ready);
    } catch {
      if (mounted.current && latest.current.key === capturedKey && revision.current === attempt)
        setMessage(controller.signal.aborted ? copy.timedOut : copy.unavailable);
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) pending.current = null;
      if (mounted.current && latest.current.key === capturedKey && revision.current === attempt) setBusy(false);
    }
  }
  const selected = bound && bound.key === key && !disabled ? bound : null;
  return <section className="border border-line bg-paper p-5" aria-label={copy.label}>
    <p className="font-serif text-sm text-ink-2">{copy.guidance}</p>
    <p className="mt-2 font-serif text-xs text-ink-3">{copy.privacy}</p>
    <label className="mt-3 block font-mono text-xs text-ink-2">{copy.jobId}
      <input className={field} value={id} maxLength={68} autoComplete="off" spellCheck={false}
        onChange={event => { invalidate(); setId(event.target.value); }} />
    </label>
    <button type="button" className={`${button} mt-3`} disabled={busy || disabled || !jobPattern.test(id) || !includedWorkspace.entries.length}
      onClick={() => void readSelection()}>{busy ? copy.reading : copy.read}</button>
    <p role="status" aria-live="polite" className="mt-2 font-serif text-sm text-seal">{message}</p>
    {selected && <CompletedEvidenceDraftImport key={JSON.stringify([selected.key, selected.revision])}
      currentOwner={selected.packet.wallet} selection={selected.packet.selection} workspace={workspace}
      baseUrl={selected.packet.baseUrl} network={selected.packet.network} onImport={value => {
        if (!mounted.current || latest.current.key !== selected.key || revision.current !== selected.revision) return false;
        return latest.current.onImport(value);
      }} />}
  </section>;
}
