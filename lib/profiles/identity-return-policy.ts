import { createHash } from "node:crypto";

/** Static navigation only; no code, state, cookie or identity enters this script. */
export const identityReturnScript = 'window.addEventListener("load",function(){setTimeout(function(){document.getElementById("continue").requestSubmit();},0);},{once:true});';
/** Next configured headers take precedence over Route Handler headers. */
export const identityReturnCsp = `default-src 'none'; script-src 'sha256-${createHash("sha256").update(identityReturnScript).digest("base64")}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
