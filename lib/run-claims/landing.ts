import { runClaimCopy } from "../../locales/en/run-claims.cjs";
import { runClaimLandingScript, runClaimLandingStyle, runClaimLandingCsp } from "./landing-assets.cjs";
import { privateRunResponse } from "./private-response";
export { runClaimLandingCsp } from "./landing-assets.cjs";
export { runClaimPrivateHeaders } from "./private-response";

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function runClaimLandingResponse(enabled: boolean) {
  const cspMeta = escape(runClaimLandingCsp);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspMeta}"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(runClaimCopy.title)}</title><style>${runClaimLandingStyle}</style></head><body data-enabled="${enabled}"><main><h1>${escape(runClaimCopy.title)}</h1><p>${escape(runClaimCopy.introduction)}</p><small>${escape(runClaimCopy.memory)}</small><p id="status" role="status" aria-live="polite"></p><p id="owner"></p><button id="signin" type="button">${escape(runClaimCopy.signIn)}</button><button id="check" type="button">${escape(runClaimCopy.check)}</button><button id="save" type="button" disabled>${escape(runClaimCopy.claim)}</button><noscript>This private link requires JavaScript. Do not share or copy its address.</noscript></main><script>${runClaimLandingScript}</script></body></html>`;
  return privateRunResponse(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": runClaimLandingCsp, "X-Frame-Options": "DENY" } }));
}
