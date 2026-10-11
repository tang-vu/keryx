import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runClaimBindingSchema, type RunClaimBinding } from "./contracts";
import { isConfiguredSameOrigin } from "../auth-origin";

import { PRIVATE_RESEARCH_PATH, PRIVATE_DOCUMENT_HEADER, PRIVATE_DOCUMENT_TTL_MS } from "./web-contract";
export { PRIVATE_RESEARCH_PATH, PRIVATE_DOCUMENT_HEADER, PRIVATE_DOCUMENT_TTL_MS } from "./web-contract";
const domain = "keryx-private-research-initial-document-v1|";
const documentSchema = z.object({ version: z.literal(1), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(), binding: runClaimBindingSchema,
}).strict();
const mac = (body: string, secret: string) => {
  const key = createHmac("sha256", secret).update("keryx-private-research-document-key-v1").digest();
  return createHmac("sha256", key).update(domain + body).digest();
};
const usableKey = (secret: string) => Buffer.byteLength(secret, "utf8") >= 32;

/** A document admission ticket only; never owner, funding or payment authority.
 * Domain separation prevents reuse as a web-session JWT. No DB or global cache. */
export function issuePrivateDocument(nonce: string, binding: RunClaimBinding, secret: string, now = Date.now()) {
  if (!usableKey(secret)) throw new Error("Private research unavailable");
  const value = documentSchema.parse({ version: 1, nonce, issuedAt: now, expiresAt: now + PRIVATE_DOCUMENT_TTL_MS, binding });
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${mac(body, secret).toString("base64url")}`;
}
export function verifyPrivateDocument(ticket: unknown, binding: RunClaimBinding, secret: string, now = Date.now()) {
  try {
    if (!usableKey(secret) || typeof ticket !== "string" || ticket.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
    const [body, signed] = ticket.split("."), signature = Buffer.from(signed, "base64url");
    if (signature.length !== 32 || signature.toString("base64url") !== signed || !timingSafeEqual(signature, mac(body, secret))) return null;
    const bytes = Buffer.from(body, "base64url"), value = documentSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (Buffer.from(JSON.stringify(value)).toString("base64url") !== body || value.binding.origin !== binding.origin
      || value.binding.network !== binding.network || value.issuedAt > now || value.expiresAt <= now
      || value.expiresAt - value.issuedAt !== PRIVATE_DOCUMENT_TTL_MS) return null;
    return value;
  } catch { return null; }
}
export function privateDocumentCsp(nonce: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new Error("Private research unavailable");
  // The trusted Next bootstrap loads first-party chunks. External wallet/RPC
  // transports and frames are deliberately absent while a claim is retained.
  return `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}
/** Browser fetch cannot set navigate/document Fetch Metadata. RSC and prefetch
 * cannot publish a bootstrap into an existing analytics-allowed document. */
export function isInitialPrivateNavigation(request: Request) {
  const url = new URL(request.url), headers = request.headers;
  return request.method === "GET" && url.pathname === PRIVATE_RESEARCH_PATH && !url.search
    && headers.get("sec-fetch-mode") === "navigate" && headers.get("sec-fetch-dest") === "document"
    && headers.get("accept")?.includes("text/html") === true
    && !["rsc", "next-router-prefetch", "next-router-state-tree"].some(key => headers.has(key))
    && headers.get("purpose") !== "prefetch" && headers.get("sec-purpose") !== "prefetch";
}
/** Next constructs proxy URLs from the listen hostname and normalizes loopback
 * hosts to localhost. The browser-facing authority is the exact configured
 * Host, with the protocol retained by Next; never trust an alternate host or a
 * comma-separated forwarded protocol. This issues document admission only. */
export function matchesPrivateNavigationAuthority(request: Request, binding: RunClaimBinding) {
  const expected = new URL(binding.origin), protocol = expected.protocol.slice(0, -1);
  return request.headers.get("host") === expected.host && new URL(request.url).protocol === expected.protocol
    && (!request.headers.has("x-forwarded-proto") || request.headers.get("x-forwarded-proto") === protocol);
}
export function admitsPrivateAsk(request: Request, binding: RunClaimBinding, secret: string) {
  return isConfiguredSameOrigin(request, binding.origin)
    && request.headers.get("sec-fetch-site") === "same-origin"
    && !!verifyPrivateDocument(request.headers.get(PRIVATE_DOCUMENT_HEADER), binding, secret);
}
