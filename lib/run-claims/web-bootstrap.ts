import { PRIVATE_DOCUMENT_SLOT, PRIVATE_RESEARCH_PATH } from "./web-contract";

/** Only a parser-executed, nonce-bound initial HTML script installs this closure.
 * React props, a pathname and an RSC response are insufficient. This is document
 * admission, not a defence against trusted same-origin privileged JavaScript. */
export function privateDocumentBootstrap(ticket: string, nonce: string) {
  const parameters = JSON.stringify({ ticket, nonce, path: PRIVATE_RESEARCH_PATH, slot: PRIVATE_DOCUMENT_SLOT }).replace(/</g, "\\u003c");
  return `(() => {
    const options = ${parameters}, current = document.currentScript, initial = document;
    if (document.readyState !== 'loading' || !current || current.nonce !== options.nonce || location.pathname !== options.path) return;
    window.opener = null;
    const slot = Symbol.for(options.slot); if (Object.prototype.hasOwnProperty.call(window, slot)) return;
    let proof = options.ticket;
    Object.defineProperty(window, slot, { value: () => document === initial && location.pathname === options.path ? proof : null });
    addEventListener('pagehide', () => { proof = null; }, { once: true });
  })();`;
}
export function readPrivateDocument(): string | null {
  if (typeof window === "undefined" || window.location.pathname !== PRIVATE_RESEARCH_PATH) return null;
  try {
    const read: unknown = Reflect.get(window, Symbol.for(PRIVATE_DOCUMENT_SLOT));
    const proof: unknown = typeof read === "function" ? read() : null;
    return typeof proof === "string" && proof.length <= 4096 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(proof) ? proof : null;
  } catch { return null; }
}
