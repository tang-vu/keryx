"use client";

import { useSyncExternalStore } from "react";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, parseLiteratureWorkspace, serializeLiteratureWorkspace, type LiteratureWorkspace } from "./literature-workspace";
import { createMessages } from "../i18n/messages";

const copy = createMessages("en");

type Snapshot = { ready: boolean; workspace: LiteratureWorkspace; error?: string; raw?: string };
const initial: Snapshot = { ready: false, workspace: emptyLiteratureWorkspace() };
const inaccessible: Snapshot = { ready: true, workspace: emptyLiteratureWorkspace(), error: copy("paperWorkspace.storageUnavailable") };
let cachedRaw: string | null | undefined, cached: Snapshot = initial;
const changeEvent = "keryx-literature-changed";

function snapshot(): Snapshot {
  let raw: string | null;
  try { raw = window.localStorage.getItem(LITERATURE_STORAGE_KEY); } catch { return inaccessible; }
  if (cached.ready && raw === cachedRaw) return cached;
  cachedRaw = raw;
  try { cached = { ready: true, workspace: raw === null ? emptyLiteratureWorkspace() : parseLiteratureWorkspace(raw) }; }
  catch { cached = { ready: true, workspace: emptyLiteratureWorkspace(), raw: raw ?? undefined,
    error: copy("paperWorkspace.readFailed") }; }
  if (!cached.error && !navigator.locks?.request) cached = { ...cached, raw: raw ?? undefined,
    error: copy("paperWorkspace.coordinationUnavailable") };
  return cached;
}
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === LITERATURE_STORAGE_KEY || event.key === null) notify(); };
  window.addEventListener("storage", onStorage); window.addEventListener(changeEvent, notify);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(changeEvent, notify); };
}
export function useLiteratureWorkspace() { return useSyncExternalStore(subscribe, snapshot, () => initial); }

async function withWorkspaceLock(action: () => void) {
  if (!navigator.locks?.request) throw new Error(copy("paperWorkspace.lockUnavailable"));
  await navigator.locks.request(LITERATURE_STORAGE_KEY, { mode: "exclusive" }, action);
}
/** Serialize all cooperating tabs. The read, stale check and write occur inside the same lock. No write on mount. */
export async function changeLiteratureWorkspace(update: (current: LiteratureWorkspace) => LiteratureWorkspace) {
  await withWorkspaceLock(() => {
    const current = snapshot();
    if (current.error) throw new Error(current.error);
    writeWorkspace(update(current.workspace));
  });
}
function writeWorkspace(workspace: LiteratureWorkspace) {
  const raw = serializeLiteratureWorkspace(workspace);
  try {
    window.localStorage.setItem(LITERATURE_STORAGE_KEY, raw);
    if (window.localStorage.getItem(LITERATURE_STORAGE_KEY) !== raw) throw new Error("Readback failed");
  } catch { throw new Error(copy("paperWorkspace.saveUnverified")); }
  window.dispatchEvent(new Event(changeEvent));
}
export async function replaceLiteratureWorkspace(workspace: LiteratureWorkspace, isCurrent: () => boolean = () => true) {
  await withWorkspaceLock(() => {
    if (!isCurrent()) throw new Error(copy("paperWorkspace.restoreCancelled"));
    writeWorkspace(workspace);
  });
}
export async function clearLiteratureWorkspace() {
  await withWorkspaceLock(() => {
    try {
      window.localStorage.removeItem(LITERATURE_STORAGE_KEY);
      if (window.localStorage.getItem(LITERATURE_STORAGE_KEY) !== null) throw new Error("Readback failed");
    } catch { throw new Error(copy("paperWorkspace.clearFailed")); }
    window.dispatchEvent(new Event(changeEvent));
  });
}
