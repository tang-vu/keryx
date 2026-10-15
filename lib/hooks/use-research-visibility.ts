"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isOwnBrowserAuthChange } from "../browser-auth-notice";
import { readBoundedJson } from "../read-bounded-json";
import type { RunVisibility } from "../run-privacy/contracts";
import type { ResearchVisibilityContext } from "../run-privacy/ask-publication";

export interface ResearchPublicationSelection { visibility: RunVisibility; expectedWallet: string | null }
type Snapshot = ResearchVisibilityContext & { visibility: RunVisibility; chosen: boolean };
const choices: RunVisibility[] = ["public", "unlisted", "private"];
const exposure = { private: 0, unlisted: 1, public: 2 };
function context(raw: unknown): ResearchVisibilityContext {
  if (!raw || typeof raw !== "object") throw new Error("Invalid visibility context");
  const value = raw as ResearchVisibilityContext;
  if (!(value.wallet === null || typeof value.wallet === "string" && /^0x[a-f0-9]{40}$/.test(value.wallet))
    || !choices.includes(value.defaultVisibility) || typeof value.privacyActive !== "boolean"
    || value.defaultVisibility === "private" && !value.wallet || !value.privacyActive && value.defaultVisibility !== "public")
    throw new Error("Invalid visibility context");
  return { wallet: value.wallet, defaultVisibility: value.defaultVisibility, privacyActive: value.privacyActive };
}
function selected(snapshot: Snapshot, parent?: RunVisibility): RunVisibility {
  return parent && exposure[parent] < exposure[snapshot.visibility] ? parent : snapshot.visibility;
}

/** Auth hints only invalidate. The fixed same-origin endpoint supplies preferences and owner preconditions. */
export function useResearchVisibility(parentVisibility?: RunVisibility, options?: { enabled?: boolean; onOwnerBoundary?: () => void }) {
  const enabled = options?.enabled !== false;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const current = useRef<Snapshot | null>(null), generation = useRef(0), live = useRef(false);
  const retained = useRef<Snapshot | null>(null), ownerRevision = useRef(0);
  const [identityRevision, setIdentityRevision] = useState(0);
  const boundaryCallback = useRef(options?.onOwnerBoundary);
  useEffect(() => { boundaryCallback.current = options?.onOwnerBoundary; }, [options?.onOwnerBoundary]);
  const revokeOwner = useCallback(() => {
    retained.current = null;
    setIdentityRevision(++ownerRevision.current);
    boundaryCallback.current?.();
  }, []);
  const pendingLogout = useRef(false), controller = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    const previous = retained.current, stamp = ++generation.current;
    controller.current?.abort(); current.current = null; setSnapshot(null); setStatus("loading");
    if (pendingLogout.current) return;
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/ask/visibility", { credentials: "same-origin", cache: "no-store", redirect: "error",
        referrerPolicy: "no-referrer", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok || response.redirected || response.url && response.url !== new URL("/api/ask/visibility", window.location.href).href)
        throw new Error("Visibility settings unavailable");
      const value = context(await readBoundedJson(response, 4096));
      if (!live.current || stamp !== generation.current || abort.signal.aborted) return;
      if (previous && (previous.wallet !== value.wallet || previous.privacyActive && !value.privacyActive)) revokeOwner();
      // A fresh default must not silently publish a draft previously composed as hidden.
      const keepChoice = previous && previous.wallet === value.wallet && (previous.chosen || previous.visibility !== "public")
        && (value.privacyActive || previous.visibility === "public");
      const next: Snapshot = { ...value, visibility: keepChoice ? previous.visibility : value.defaultVisibility, chosen: !!keepChoice };
      retained.current = next; current.current = next; setSnapshot(next); setStatus("ready");
    } catch {
      if (live.current && stamp === generation.current && !abort.signal.aborted) setStatus("error");
    }
  }, [revokeOwner]);
  useEffect(() => {
    if (!enabled) return;
    live.current = true;
    const changed = (detail?: unknown) => {
      if (detail && typeof detail === "object" && "type" in detail && detail.type === "logout" && "pending" in detail) {
        pendingLogout.current = detail.pending === true;
        if (pendingLogout.current || "confirmed" in detail && detail.confirmed === true) revokeOwner();
      }
      else pendingLogout.current = false;
      if (detail === "signed-out") revokeOwner();
      void reload();
    };
    const auth = (event: Event) => changed((event as CustomEvent).detail), focused = () => { void reload(); };
    window.addEventListener("keryx:auth", auth); window.addEventListener("focus", focused);
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel("keryx-auth-v1"); channel.onmessage = event => {
      if (!isOwnBrowserAuthChange(event.data)) changed(event.data);
    }; } catch { /* Focus and local auth events still perform a fresh check. */ }
    void reload();
    return () => { live.current = false; generation.current++; current.current = null; retained.current = null; controller.current?.abort();
      window.removeEventListener("keryx:auth", auth); window.removeEventListener("focus", focused); channel?.close(); };
  }, [enabled, reload, revokeOwner]);
  const choose = useCallback((visibility: RunVisibility) => {
    const value = current.current;
    if (!value || !choices.includes(visibility) || !value.privacyActive && visibility !== "public"
      || visibility === "private" && !value.wallet || parentVisibility && exposure[visibility] > exposure[parentVisibility]) return;
    const next = { ...value, visibility, chosen: true }; retained.current = next; current.current = next; setSnapshot(next);
  }, [parentVisibility]);
  const getSelection = useCallback((): ResearchPublicationSelection | null => {
    const value = current.current;
    if (!value) return null;
    const visibility = selected(value, parentVisibility);
    return visibility === "private" && !value.wallet || visibility !== "public" && !value.privacyActive
      ? null : { visibility, expectedWallet: value.wallet };
  }, [parentVisibility]);
  const getIdentityRevision = useCallback(() => ownerRevision.current, []);
  const selectionReady = snapshot !== null && (selected(snapshot, parentVisibility) === "public" || snapshot.privacyActive)
    && (selected(snapshot, parentVisibility) !== "private" || snapshot.wallet !== null);
  return { status, ready: status === "ready" && selectionReady, wallet: snapshot?.wallet ?? null,
    identityRevision, getIdentityRevision,
    privacyActive: snapshot?.privacyActive ?? false, visibility: snapshot ? selected(snapshot, parentVisibility) : "public" as const,
    choose, getSelection, retry: () => { void reload(); } };
}
