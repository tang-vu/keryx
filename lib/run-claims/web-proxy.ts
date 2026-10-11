import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { RunClaimBinding } from "./contracts";
import { runClaimPrivateHeaders } from "./private-headers.cjs";
import { isInitialPrivateNavigation, issuePrivateDocument, matchesPrivateNavigationAuthority, privateDocumentCsp } from "./web-document";

export function privateResearchProxy(request: NextRequest, binding: RunClaimBinding, secret: string, enabled: boolean) {
  const nonce = randomBytes(32).toString("base64url"), csp = privateDocumentCsp(nonce);
  let response: NextResponse;
  if (!isInitialPrivateNavigation(request) || !matchesPrivateNavigationAuthority(request, binding)) {
    response = new NextResponse("Open private research with a full page navigation.", { status: 409 });
  } else {
    const headers = new Headers(request.headers);
    // Always overwrite client-supplied internal headers. Only this actual
    // document navigation can reach a server-rendered initial bootstrap.
    headers.delete("x-keryx-private-bootstrap");
    headers.set("x-keryx-private-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    if (enabled) {
      try { headers.set("x-keryx-private-bootstrap", issuePrivateDocument(nonce, binding, secret)); }
      catch { /* No usable authority means an unavailable private entry. */ }
    }
    response = NextResponse.next({ request: { headers } });
  }
  for (const header of runClaimPrivateHeaders) response.headers.set(header.key, header.value);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return response;
}
