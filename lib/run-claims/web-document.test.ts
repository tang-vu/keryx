import { NextRequest } from "next/server";
import { expect, it } from "vitest";
import { admitsPrivateAsk, issuePrivateDocument, verifyPrivateDocument, PRIVATE_DOCUMENT_TTL_MS } from "./web-document";
import { privateResearchProxy } from "./web-proxy";
const binding = { network: "eip155:5042002", origin: "https://synthetic.example" } as const;
const secret = "synthetic-test-document-key-only-123456789", nonce = "n".repeat(43), now = 1700000000000;
const navigation = { Host: "synthetic.example", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", Accept: "text/html" };
it("binds a finite document ticket to origin, network, nonce and exact time, with no ownership/payment authority", () => {
  const ticket = issuePrivateDocument(nonce, binding, secret, now);
  expect(verifyPrivateDocument(ticket, binding, secret, now)).toMatchObject({ nonce, issuedAt: now, expiresAt: now + PRIVATE_DOCUMENT_TTL_MS, binding });
  expect(verifyPrivateDocument(ticket, binding, secret, now + PRIVATE_DOCUMENT_TTL_MS)).toBeNull();
  expect(verifyPrivateDocument(ticket, binding, secret, now - 1)).toBeNull();
  expect(verifyPrivateDocument(ticket, { ...binding, network: "eip155:5042" }, secret, now)).toBeNull();
  expect(verifyPrivateDocument(ticket, { ...binding, origin: "https://other.example" }, secret, now)).toBeNull();
  expect(verifyPrivateDocument(ticket, binding, secret + "x", now)).toBeNull();
  expect(() => issuePrivateDocument(nonce, binding, "weak", now)).toThrow();
});
it.each([null, {}, "x".repeat(5000), "payload.signature", "../claim-run", "a.b.c"])("refuses malformed proof uniformly: %j", value => {
  expect(verifyPrivateDocument(value, binding, secret, now)).toBeNull();
});
it("requires the signed document ticket and same-origin Fetch Metadata, never a pathname marker", () => {
  const ticket = issuePrivateDocument(nonce, binding, secret);
  const request = (headers: Record<string, string>) => new Request(binding.origin + "/api/ask", { method: "POST", headers });
  expect(admitsPrivateAsk(request({ Origin: binding.origin, "Sec-Fetch-Site": "same-origin", "X-Keryx-Private-Document": ticket }), binding, secret)).toBe(true);
  expect(admitsPrivateAsk(request({ Origin: binding.origin, "Sec-Fetch-Site": "same-origin", "X-Keryx-Private-Document": "/research/private" }), binding, secret)).toBe(false);
  expect(admitsPrivateAsk(request({ Origin: "https://other.example", "Sec-Fetch-Site": "cross-site", "X-Keryx-Private-Document": ticket }), binding, secret)).toBe(false);
});
it("checks configured Origin for real NextRequest loopback normalization without accepting Host as API authority", () => {
  const bound = { ...binding, origin: "http://127.0.0.1:3939" }, ticket = issuePrivateDocument(nonce, bound, secret);
  const req = (origin: string, proof = ticket, site = "same-origin") => new NextRequest(bound.origin + "/api/ask", {
    method: "POST", headers: { Origin: origin, Host: "spoof.example", "Sec-Fetch-Site": site, "X-Keryx-Private-Document": proof },
  });
  expect(new URL(req(bound.origin).url).hostname).toBe("localhost");
  expect(admitsPrivateAsk(req(bound.origin), bound, secret)).toBe(true);
  expect(admitsPrivateAsk(req("http://localhost:3939"), bound, secret)).toBe(false);
  expect(admitsPrivateAsk(req("https://other.example"), bound, secret)).toBe(false);
  expect(admitsPrivateAsk(req(bound.origin, "invalid"), bound, secret)).toBe(false);
  expect(admitsPrivateAsk(req(bound.origin, ticket, "cross-site"), bound, secret)).toBe(false);
});
it("only initial hard navigation installs fresh request nonce/bootstrap and exact private response policy", () => {
  const req = () => new NextRequest(binding.origin + "/research/private", { headers: { ...navigation, "x-keryx-private-bootstrap": "spoof", "x-keryx-private-nonce": "spoof" } });
  const response = privateResearchProxy(req(), binding, secret, true), next = privateResearchProxy(req(), binding, secret, true);
  const proof = response.headers.get("x-middleware-request-x-keryx-private-bootstrap");
  expect(verifyPrivateDocument(proof, binding, secret)).not.toBeNull();
  expect(response.headers.get("content-security-policy")).not.toBe(next.headers.get("content-security-policy"));
  expect(response.headers.get("content-security-policy")).not.toMatch(/cloudflare|unsafe-eval|https:|connect-src.*walletconnect/);
  expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow"); expect(response.headers.get("x-frame-options")).toBe("DENY");
});
const refusedHeaders: Record<string, string>[] = [{ RSC: "1" }, { "Next-Router-Prefetch": "1" }, { "Next-Router-State-Tree": "[]" }, { Purpose: "prefetch" }, { "Sec-Fetch-Mode": "cors" }, { "Sec-Fetch-Dest": "empty" }];
it.each(refusedHeaders)("refuses in-app/prefetch issuance before rendering: %j", extra => {
  const response = privateResearchProxy(new NextRequest(binding.origin + "/research/private", { headers: { ...navigation, ...extra } }), binding, secret, true);
  expect(response.status).toBe(409); expect(response.headers.has("x-middleware-request-x-keryx-private-bootstrap")).toBe(false);
});
it("default-off/weak-key documents have no claim admission bootstrap", () => {
  for (const [key, enabled] of [[secret, false], ["", true]] as const) {
    const response = privateResearchProxy(new NextRequest(binding.origin + "/research/private", { headers: navigation }), binding, key, enabled);
    expect(response.headers.has("x-middleware-request-x-keryx-private-bootstrap")).toBe(false);
  }
});
it("binds the browser-facing Host/protocol while tolerating Next's internal listen hostname", () => {
  const response = privateResearchProxy(new NextRequest("https://localhost:3939/research/private", { headers: navigation }), binding, secret, true);
  expect(response.status).toBe(200);
  expect(verifyPrivateDocument(response.headers.get("x-middleware-request-x-keryx-private-bootstrap"), binding, secret)).not.toBeNull();
  const refused: Record<string, string>[] = [{ Host: "other.example" }, { Host: "synthetic.example:3939" }, { Host: "" }, { "X-Forwarded-Proto": "http" }, { "X-Forwarded-Proto": "https,http" }];
  for (const extra of refused) {
    expect(privateResearchProxy(new NextRequest("https://localhost:3939/research/private", { headers: { ...navigation, ...extra } }), binding, secret, true).status).toBe(409);
  }
  expect(privateResearchProxy(new NextRequest("http://localhost:3939/research/private", { headers: navigation }), binding, secret, true).status).toBe(409);
});
