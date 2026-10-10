import { createHash } from "node:crypto";
import { runClaimCopy } from "../../locales/en/run-claims";
import { runClaimLandingClient } from "./landing-client";
import { privateRunResponse } from "./private-response";
export { runClaimPrivateHeaders } from "./private-response";

const script = `(() => { const copy = ${JSON.stringify(runClaimCopy).replace(/</g, "\\u003c")};${runClaimLandingClient}})();`;
const style = "body{margin:0;background:#f7f3ea;color:#242722;font:18px/1.6 system-ui,sans-serif}main{max-width:680px;margin:8vh auto;padding:24px}h1{font:2rem/1.2 Georgia,serif}button{font:inherit;padding:10px 14px;margin:8px 8px 8px 0;cursor:pointer}button:disabled{cursor:default}#owner{overflow-wrap:anywhere;font-family:monospace}#status{min-height:3em}small{display:block}";
const cspHash = (value: string) => `'sha256-${createHash("sha256").update(value, "utf8").digest("base64")}'`;
/** Stable across config and route compilation: literal emitted bytes, no function.toString().
 * Analytics scripts (including same-origin injections) have no matching script hash. */
export const runClaimLandingCsp = `default-src 'none'; script-src ${cspHash(script)}; style-src ${cspHash(style)}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function runClaimLandingResponse(enabled: boolean) {
  const cspMeta = escape(runClaimLandingCsp);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspMeta}"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(runClaimCopy.title)}</title><style>${style}</style></head><body data-enabled="${enabled}"><main><h1>${escape(runClaimCopy.title)}</h1><p>${escape(runClaimCopy.introduction)}</p><small>${escape(runClaimCopy.memory)}</small><p id="status" role="status" aria-live="polite"></p><p id="owner"></p><button id="signin" type="button">${escape(runClaimCopy.signIn)}</button><button id="check" type="button">${escape(runClaimCopy.check)}</button><button id="save" type="button" disabled>${escape(runClaimCopy.claim)}</button><noscript>This private link requires JavaScript. Do not share or copy its address.</noscript></main><script>${script}</script></body></html>`;
  return privateRunResponse(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": runClaimLandingCsp, "X-Frame-Options": "DENY" } }));
}
