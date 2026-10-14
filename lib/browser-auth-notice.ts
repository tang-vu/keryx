"use client";

// This identifier distinguishes delivery within this document; it grants no
// authentication. Only the local event starts a fresh server session check.
let documentSource: string | undefined;
export function isOwnBrowserAuthChange(value: unknown): boolean {
  if (!documentSource || !value || typeof value !== "object") return false;
  const notice = value as { type?: unknown; source?: unknown };
  return notice.type === "changed" && notice.source === documentSource;
}
export function notifyBrowserAuthChanged() {
  documentSource ??= crypto.randomUUID();
  window.dispatchEvent(new Event("keryx:auth"));
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel("keryx-auth-v1");
    channel.postMessage({ type: "changed", source: documentSource });
  } catch { /* The local event already started verification. */ }
  finally { channel?.close(); }
}
