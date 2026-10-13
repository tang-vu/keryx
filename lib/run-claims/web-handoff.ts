import { privateRunClaimPacketSchema } from "./private-packet";

export type PrivateClaimStatus = "none" | "waiting" | "available" | "unavailable" | "lost" | "opened";
/** The credential stays in this one-shot closure, outside React state, DOM,
 * saved turn/history, clipboard, device storage, exports and public projectors. */
export function createPrivateClaimHandoff(options: {
  origin(): string; documentProof(): string | null; open(url: string): void; now?: () => number;
}) {
  let status: PrivateClaimStatus = "none", savedId: string | null = null, candidate: string | null = null;
  let documentProof: string | null = null;
  let invalid = false, received = false, expires = 0, active = false;
  const listeners = new Set<(status: PrivateClaimStatus) => void>();
  const update = (next: PrivateClaimStatus) => { status = next; for (const listener of listeners) listener(status); };
  const forget = () => { savedId = null; candidate = null; documentProof = null; expires = 0; received = false; active = false; };
  const reject = () => {
    invalid = true; candidate = null; expires = 0;
    if (status === "available") { forget(); update("unavailable"); }
  };
  const sameDocument = () => documentProof !== null && options.documentProof() === documentProof;
  const now = options.now ?? Date.now;
  return Object.freeze({
    subscribe(listener: (value: PrivateClaimStatus) => void) { listeners.add(listener); listener(status); return () => { listeners.delete(listener); }; },
    begin() {
      forget(); invalid = false;
      const proof = options.documentProof();
      if (!proof) { update("unavailable"); return null; }
      documentProof = proof; active = true; update("waiting"); return proof;
    },
    saved(id: unknown) { if (active && typeof id === "string" && !savedId) savedId = id; else reject(); },
    packet(raw: string) {
      if (!active || !savedId || received || raw.length > 8192) { reject(); return; }
      received = true;
      try {
        const parsed = JSON.parse(raw);
        // Our SSE writer emits JSON.stringify bytes. Do not let JSON.parse
        // silently collapse duplicate fields into an apparently valid packet.
        if (JSON.stringify(parsed) !== raw) throw new Error("Ambiguous private delivery");
        const value = privateRunClaimPacketSchema.parse(parsed);
        if (value.runId !== savedId) throw new Error("Unbound private delivery");
        if (value.status === "unavailable") { reject(); return; }
        const url = new URL(value.delivery.claimUrl);
        expires = Date.parse(value.delivery.expiresAt);
        if (!sameDocument() || url.origin !== options.origin() || expires <= now()) throw new Error("Unbound private delivery");
        candidate = url.href;
      } catch { reject(); }
    },
    finish() {
      if (!active) return;
      active = false;
      if (invalid || candidate && expires <= now() || !sameDocument()) { forget(); update("unavailable"); }
      else if (candidate && savedId) update("available");
      else { forget(); update("none"); } // An owned completion has no anonymous packet.
    },
    fail() { const pending = active || status === "waiting"; forget(); update(pending ? "lost" : "none"); },
    clear() { forget(); invalid = false; update("none"); },
    open() {
      const url = status === "available" && !invalid && expires > now() && sameDocument() ? candidate : null;
      forget(); update(url ? "opened" : "unavailable");
      if (url) { try { options.open(url); } catch { update("lost"); } }
      // No result acknowledgement, retry, recovery or replacement credential.
    },
  });
}
export type PrivateClaimHandoff = ReturnType<typeof createPrivateClaimHandoff>;
