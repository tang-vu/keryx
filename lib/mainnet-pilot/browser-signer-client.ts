"use client";
import type { PilotBrowserRequest } from "./browser-wire";
/** Dedicated entry only. No network/policy/transport selector crosses this port. */
export function mainnetPilotSignerClient() {
  const worker = new Worker(new URL("../session/mainnet-pilot-signer.worker.ts", import.meta.url));
  let id = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  function close() { worker.terminate(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("pilot worker closed")); } pending.clear(); }
  worker.onerror = close;
  worker.onmessage = event => {
    const item = pending.get(event.data?.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(event.data.id);
    if (event.data.ok === true) item.resolve(event.data.result); else item.reject(new Error("pilot worker refused operation"));
  };
  return Object.freeze({
    call<T>(request: PilotBrowserRequest): Promise<T> {
      const next = ++id;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(next); reject(new Error("pilot worker timed out; retained capacity requires review")); }, 30000);
        pending.set(next, { resolve: value => resolve(value as T), reject, timer }); worker.postMessage({ ...request, id: next });
      });
    }, close,
  });
}
