"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { buildEvidenceDraft, evidenceDraftReportSchema, evidenceDraftWorkspace, parseEvidenceDraftRequest,
  type EvidenceDraftRequest } from "@/lib/research/evidence-draft";
import type { LiteratureWorkspace } from "@/lib/papers/literature-workspace";
import type { CompletedEvidenceDraftPacket, CompletedReadSelection } from "@/lib/research/completed-evidence-draft";
import { completedEvidenceDraftImportCopy as english } from "@/locales/en/completed-evidence-draft-selection";
import { UiText, useUiCopy } from "@/lib/i18n/ui-copy";
export interface CompletedEvidenceDraftImportProps {
  currentOwner: string | null;
  /** An explicit completed selection with its previously retained snapshot digest.
   * A private-result public projection cannot supply missing URL/version/hash data. */
  selection: CompletedReadSelection | null;
  workspace: LiteratureWorkspace;
  baseUrl: string;
  network: string;
  /** Append to the CURRENT editor, preserving passage/theme/unfinished edits.
   * Return false if its current capacity or excerpt bindings refuse the append. */
  onImport: (value: CompletedEvidenceDraftImportValue) => boolean;
}
export interface CompletedEvidenceDraftImportValue {
  report: EvidenceDraftRequest["reports"][number];
  readingStatuses: NonNullable<EvidenceDraftRequest["readingStatuses"]>;
}
type Editors = Pick<EvidenceDraftRequest, "reports" | "passage" | "claims" | "themes" | "readingStatuses">;

/** Apply against current tab state. Validate written statements without losing
 * unfinished editor rows; assembly remains a separate explicit author action. */
export function appendCompletedEvidenceDraftImport(current: Editors, workspace: LiteratureWorkspace,
  value: CompletedEvidenceDraftImportValue): Editors {
  const incoming = parseEvidenceDraftRequest({ version: 1, scope: "private-evidence-draft",
    workspace: evidenceDraftWorkspace(workspace), reports: [value.report], readingStatuses: value.readingStatuses,
    passage: "", claims: [], themes: [] });
  buildEvidenceDraft(incoming);
  if (incoming.readingStatuses?.some(row => row.status !== "unavailable")
    || current.reports.length >= 8 || current.reports.some(row => row.id === incoming.reports[0].id)) throw new Error();
  const reports = [...current.reports, incoming.reports[0]];
  const themes = current.themes.map(({ statements, ...theme }) => {
    const written = (statements ?? []).filter(row => row.text.trim());
    return written.length ? { ...theme, statements: written } : theme;
  });
  const request = { version: 1 as const, scope: "private-evidence-draft" as const,
    workspace: incoming.workspace, ...current, reports, themes };
  const retained = new Set(buildEvidenceDraft({ ...request, readingStatuses: [] }).excerpts.map(row => row.paperUrl));
  const observations = new Map((current.readingStatuses ?? []).map(row => [row.paperUrl, row]));
  for (const row of incoming.readingStatuses ?? []) observations.set(row.paperUrl, row);
  // Only actual retained excerpts supersede observations. An unavailable read
  // replaces a prior unread observation for that exact paper; other rows stay.
  const readingStatuses = [...observations.values()].filter(row => !retained.has(row.paperUrl));
  buildEvidenceDraft({ ...request, readingStatuses });
  return { ...current, reports, readingStatuses };
}
const button = "inline-flex min-h-11 items-center border border-ink px-3 py-2 font-mono text-xs text-ink disabled:opacity-50";
const selectionKey = (value: CompletedReadSelection) => JSON.stringify([value.id, value.savedAt, value.snapshotSha256,
  value.question, value.budget, value.researchMode, value.sources.map(row => [row.sourceId, row.itemId, row.itemUrl, row.contentVersion])]);

/** An explicit action only. No history polling, automatic paid read, persistence,
 * telemetry, URL selector, engine dispatch or private answer rendering. */
export function CompletedEvidenceDraftImport(props: CompletedEvidenceDraftImportProps) {
  const copy = useUiCopy("completed-evidence-draft-selection", english);
  const { currentOwner, selection, workspace, baseUrl, network } = props;
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<"" | "empty" | "imported" | "unavailable" | "timedOut">("");
  const pending = useRef<AbortController | null>(null), mounted = useRef(false);
  const key = JSON.stringify({ currentOwner, selection, workspace: evidenceDraftWorkspace(workspace), baseUrl, network });
  const latest = useRef({ key, onImport: props.onImport });
  useLayoutEffect(() => { latest.current = { key, onImport: props.onImport }; }, [key, props.onImport]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  useEffect(() => { pending.current?.abort(); setBusy(false); setMessage(""); }, [key]);
  async function importCompleted() {
    if (busy || !currentOwner || !selection) return;
    const controller = new AbortController(); pending.current = controller;
    const capturedKey = key;
    setBusy(true); setMessage("");
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      if (new URL(baseUrl).origin !== window.location.origin || !/^0x[a-f0-9]{40}$/.test(currentOwner)) throw new Error();
      const response = await fetch("/api/research/evidence-draft/completed-read", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Keryx-Expected-Owner": currentOwner },
        body: JSON.stringify({ version: 1, capability: "owned-private-completed-read-v1", baseUrl, network,
          selection, workspace: evidenceDraftWorkspace(workspace) }),
      });
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if ((size += value.byteLength) > 524288) throw new Error();
          chunks.push(value);
        }
      } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const packet = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as CompletedEvidenceDraftPacket;
      // This is a session-bound response check, never a portable authenticity token.
      if (controller.signal.aborted || !mounted.current || latest.current.key !== capturedKey) return;
      if (packet.format !== "completed-evidence-draft-v1" || packet.wallet !== currentOwner
        || packet.capability !== "owned-private-completed-read-v1" || packet.baseUrl !== baseUrl || packet.network !== network
        || !packet.selection || selectionKey(packet.selection) !== selectionKey(selection)
        || packet.provenance?.origin !== "authenticated-owned-saved-ledger"
        || packet.provenance.snapshotSha256 !== selection.snapshotSha256) throw new Error();
      const editable = parseEvidenceDraftRequest(packet.editableRequest);
      if (editable.reports.length !== 1 || editable.reports[0].id !== selection.id
        || JSON.stringify(editable.workspace) !== JSON.stringify(evidenceDraftWorkspace(workspace))) throw new Error();
      const report = evidenceDraftReportSchema.parse(editable.reports[0]);
      const readingStatuses = editable.readingStatuses ?? [];
      if (readingStatuses.some(row => row.status !== "unavailable"
        || !selection.sources.some(source => source.itemUrl === row.paperUrl))) throw new Error();
      const count = buildEvidenceDraft(editable).excerpts.length;
      if (!latest.current.onImport({ report, readingStatuses })) throw new Error();
      if (!count) { setMessage("empty"); return; }
      setMessage("imported");
    } catch {
      if (mounted.current && latest.current.key === capturedKey && !controller.signal.aborted)
        setMessage("unavailable");
      else if (mounted.current && latest.current.key === capturedKey)
        setMessage("timedOut");
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) pending.current = null;
      if (mounted.current && latest.current.key === capturedKey) setBusy(false);
    }
  }
  return <section className="border border-line bg-paper p-5" aria-label={copy.label}>
    <p className="font-serif text-sm text-ink-2"><UiText source={english.guidance} namespaces={["completed-evidence-draft-selection"]} /></p>
    <p className="mt-2 font-serif text-xs text-ink-3"><UiText source={english.privacy} namespaces={["completed-evidence-draft-selection"]} /></p>
    <button type="button" className={`${button} mt-3`} disabled={busy || !currentOwner || !selection} onClick={() => void importCompleted()}>
      <UiText source={busy ? english.reading : english.import} namespaces={["completed-evidence-draft-selection"]} />
    </button>
    <p role="status" aria-live="polite" className="mt-2 font-serif text-sm text-seal"><UiText source={message ? english[message] : ""} namespaces={["completed-evidence-draft-selection"]} /></p>
  </section>;
}
