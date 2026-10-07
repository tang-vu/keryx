"use client";

import { useSyncExternalStore } from "react";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, parseLiteratureWorkspace, serializeLiteratureWorkspace, type LiteratureWorkspace } from "./literature-workspace";

type Snapshot = { ready: boolean; workspace: LiteratureWorkspace; error?: string; raw?: string };
const initial: Snapshot = { ready: false, workspace: emptyLiteratureWorkspace() };
const inaccessible: Snapshot = { ready: true, workspace: emptyLiteratureWorkspace(), error: "Browser storage is unavailable. Saving is disabled; existing data has not been cleared." };
let cachedRaw: string | null | undefined, cached: Snapshot = initial;
const changeEvent = "keryx-literature-changed";

function snapshot(): Snapshot {
  let raw: string | null;
  try { raw = window.localStorage.getItem(LITERATURE_STORAGE_KEY); } catch { return inaccessible; }
  if (cached.ready && raw === cachedRaw) return cached;
  cachedRaw = raw;
  try { cached = { ready: true, workspace: raw === null ? emptyLiteratureWorkspace() : parseLiteratureWorkspace(raw) }; }
  catch { cached = { ready: true, workspace: emptyLiteratureWorkspace(), raw: raw ?? undefined,
    error: "Saved workspace could not be read. Download the stored backup before replacing or clearing it." }; }
  if (!cached.error && !navigator.locks?.request) cached = { ...cached, raw: raw ?? undefined,
    error: "This browser cannot coordinate safe saves across tabs. Use a browser with Web Locks on HTTPS or download your stored data here." };
  return cached;
}
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === LITERATURE_STORAGE_KEY || event.key === null) notify(); };
  window.addEventListener("storage", onStorage); window.addEventListener(changeEvent, notify);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(changeEvent, notify); };
}
export function useLiteratureWorkspace() { return useSyncExternalStore(subscribe, snapshot, () => initial); }

async function withWorkspaceLock(action: () => void) {
  if (!navigator.locks?.request) throw new Error("This browser does not support safe workspace saves across tabs.");
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
  } catch { throw new Error("Could not verify the browser save. Export your work and check browser storage before continuing."); }
  window.dispatchEvent(new Event(changeEvent));
}
export async function replaceLiteratureWorkspace(workspace: LiteratureWorkspace, isCurrent: () => boolean = () => true) {
  await withWorkspaceLock(() => {
    if (!isCurrent()) throw new Error("Restore cancelled before saving. Existing workspace has been kept.");
    writeWorkspace(workspace);
  });
}
export async function clearLiteratureWorkspace() {
  await withWorkspaceLock(() => {
    try {
      window.localStorage.removeItem(LITERATURE_STORAGE_KEY);
      if (window.localStorage.getItem(LITERATURE_STORAGE_KEY) !== null) throw new Error("Readback failed");
    } catch { throw new Error("Could not clear this workspace. Check browser storage and try again."); }
    window.dispatchEvent(new Event(changeEvent));
  });
}
