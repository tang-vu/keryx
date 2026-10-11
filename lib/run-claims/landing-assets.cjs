/** Config-safe literal bytes shared by the standalone renderer and Next headers.
 * Keep this graph plain JavaScript with explicit file extensions: Next evaluates
 * configuration before application bundling or TypeScript module resolution. */
const { createHash } = require("node:crypto");
const { runClaimCopy } = require("../../locales/en/run-claims.cjs");
const { runClaimLandingClient } = require("./landing-client.cjs");

const runClaimLandingScript = `(() => { const copy = ${JSON.stringify(runClaimCopy).replace(/</g, "\\u003c")};${runClaimLandingClient}})();`;
const runClaimLandingStyle = "body{margin:0;background:#f7f3ea;color:#242722;font:18px/1.6 system-ui,sans-serif}main{max-width:680px;margin:8vh auto;padding:24px}h1{font:2rem/1.2 Georgia,serif}button{font:inherit;padding:10px 14px;margin:8px 8px 8px 0;cursor:pointer}button:disabled{cursor:default}#owner{overflow-wrap:anywhere;font-family:monospace}#status{min-height:3em}small{display:block}";
/** @param {string} value */
const cspHash = (value) => `'sha256-${createHash("sha256").update(value, "utf8").digest("base64")}'`;
/** Stable across config and route compilation: literal emitted bytes, no function.toString().
 * Analytics scripts (including same-origin injections) have no matching script hash. */
const runClaimLandingCsp = `default-src 'none'; script-src ${cspHash(runClaimLandingScript)}; style-src ${cspHash(runClaimLandingStyle)}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`;

module.exports = { runClaimLandingScript, runClaimLandingStyle, runClaimLandingCsp };
