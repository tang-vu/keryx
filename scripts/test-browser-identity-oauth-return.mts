/** Hermetic REAL Chromium cookie policy + actual identity routes + genuine durable
 * web sessions. Only external OAuth exchange is fake. Author status: UNRUN. */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node";
import { sendResponse } from "next/dist/server/send-response";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../next.config";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { issueWebSession, parseWebSession, isWebSessionActive, webSessionHash } from "../lib/auth-session";
import { createIdentityRoutes } from "../lib/profiles/identity-route";
import { identityCookieName, identityContinuationCookieName, readIdentityFlow, uniqueIdentityCookieValue } from "../lib/profiles/identity-flow";
import { requireProfileIdentities } from "../lib/profiles/verified-identities";

interface ReturnTransport {
  request(): { url(): string; method(): string; allHeaders(): Promise<Record<string, string>>; postDataBuffer(): Buffer | null };
  fulfill(options: { status?: number; headers?: Record<string, string>; contentType?: string; body?: string }): Promise<void>;
  abort(): Promise<void>;
}
const origin = "https://keryx-return.test", providerOrigin = "https://provider-return.test";
const wallet = `0x${"a".repeat(40)}`, secret = randomBytes(48).toString("hex");
const storage = new AsyncLocalStorage<Request>();
const root = await mkdtemp(join(tmpdir(), "keryx-identity-oauth-return-"));
const db = new SqliteAdapter(join(root, "ordinary.sqlite"));
const originalFetch = globalThis.fetch;
let forbiddenFetches = 0, externalBrowserRequests = 0;
globalThis.fetch = async () => { forbiddenFetches++; throw new Error("Hermetic harness forbids outbound fetch"); };
const results: unknown[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  // TSX ESM imports this .ts config through the project CommonJS boundary.
  const config = "default" in nextConfig ? nextConfig.default as typeof nextConfig : nextConfig;
  const headerRules = await config.headers?.(); assert(headerRules);
  await db.init();
  assert(db.privateProfiles && db.profileIdentities, "Actual ordinary stores required; no fallback");
  await db.privateProfiles.update(wallet, { displayName: "Return Reader", handle: "", bio: "", purpose: "Papers", links: [] });
  browser = await chromium.launch({ headless: true });
  for (const provider of ["github", "orcid"] as const) for (const mode of ["auto", "manual", "missing", "replaced", "revoked", "denied", "unlink-inflight"] as const) {
    const path = `/api/me/profile/identities/${provider}/callback`, callback = `${origin}${path}`;
    const issued = await issueWebSession(db, secret, wallet, "asker");
    const issuedClaims = await parseWebSession(issued.token, secret); assert(issuedClaims);
    assert(await isWebSessionActive(db, issuedClaims));
    const currentId = webSessionHash(issuedClaims.jti);
    let exchanges = 0, sessionReads = 0, documents = 0, expectedVerifier: string | undefined;
    let externalGetObserved = false, postObserved = false;
    const logs: { path: string; method: string; query: boolean; strict: boolean; flow: boolean; continuation: boolean }[] = [];
    const routes = createIdentityRoutes({
      applicationOrigin: origin, secret, db: async () => db,
      key: async () => { throw new Error("No bearer authority in browser return"); },
      provider: p => ({ provider: p, clientId: "hermetic-client", clientSecret: "hermetic-secret", redirectUri: `${origin}/api/me/profile/identities/${p}/callback` }),
      session: async () => {
        sessionReads++;
        const request = storage.getStore(); assert(request, "Request-scoped genuine session reader");
        const claims = await parseWebSession(uniqueIdentityCookieValue(request, "keryx_session"), secret);
        if (!claims || !await isWebSessionActive(db, claims)) return Response.json({ error: "unauthenticated" }, { status: 401 });
        return { db, wallet: claims.address.toLowerCase(), currentId: webSessionHash(claims.jti) };
      },
      exchange: async (config, input) => {
        exchanges++; assert.equal(config.provider, provider); assert.equal(input.code, "hermetic-code");
        assert.equal(input.codeVerifier, expectedVerifier);
        // Durable consume must precede even this fake provider seam. It cannot consume again.
        const request = storage.getStore()!;
        const flow = await readIdentityFlow(uniqueIdentityCookieValue(request, identityCookieName(provider)), secret, Date.now()); assert(flow);
        await assert.rejects(requireProfileIdentities(db).consume({ wallet: flow.wallet, provider, sessionHash: flow.sessionHash, stateHash: flow.stateHash, expiresAt: flow.expiresAt }));
        if (mode === "unlink-inflight") await requireProfileIdentities(db).unlink(wallet, provider);
        return provider === "github" ? { provider, externalId: "12345", label: "return-reader" }
          : { provider, externalId: "0000-0002-1825-0097", label: "Return Reader" };
      },
    });
    const context = await browser.newContext({ javaScriptEnabled: mode !== "manual", serviceWorkers: "block" });
    try {
      await context.addCookies([{ name: "keryx_session", value: issued.token, url: origin, httpOnly: true, secure: true, sameSite: "Strict" }]);
      const initialSessionCookie = (await context.cookies(origin)).find(cookie => cookie.name === "keryx_session")!;
      let state = "", originalFlow = "", continuation = "";
      // Chromium routes are a transport-only fence: they forward the actual browser-generated
      // headers and zero-byte form body into createIdentityRoutes and return its actual responses.
      const page = await context.newPage(), transport = await context.newCDPSession(page);
      let transportFailure: unknown;
      const fulfill = async (route: ReturnTransport, response: Response) => {
        const incoming = new IncomingMessage(new Socket()); incoming.method = "HEAD";
        const outgoing = new ServerResponse(incoming), pathname = new URL(route.request().url()).pathname;
        for (const rule of headerRules) if (getPathMatch(rule.source)(pathname)) {
          assert(!rule.has && !rule.missing, "No unmodelled conditional header rule");
          for (const header of rule.headers) outgoing.setHeader(header.key, header.value);
        }
        // Reuse actual Next header precedence and cookie forwarding. HEAD suppresses
        // only body piping; the original actual handler body is fulfilled unchanged.
        await sendResponse(new NodeNextRequest(incoming), new NodeNextResponse(outgoing), response.clone());
        const responseHeaders = Object.fromEntries(Object.entries(outgoing.getHeaders()).map(([name, value]) =>
          [name, Array.isArray(value) ? value.join(name.toLowerCase() === "set-cookie" ? "\n" : ", ") : String(value)]));
        await route.fulfill({ status: outgoing.statusCode, headers: responseHeaders, body: await response.text() });
      };
      const handle = async (route: ReturnTransport) => {
        const incoming = route.request(), url = new URL(incoming.url());
        const browserHeaders = await incoming.allHeaders();
        if (url.origin === providerOrigin && url.pathname === "/consent" && !url.search) {
          assert(!browserHeaders.cookie, "No Keryx cookie reaches foreign provider document");
          const query = mode === "denied" ? `state=${state}&error=access_denied&error_description=hermetic-private-detail` : `code=hermetic-code&state=${state}`;
          return route.fulfill({ contentType: "text/html", headers: { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
            body: `<!doctype html><html><body><a href="${callback}?${query}">Return to Keryx</a></body></html>` });
        }
        if (url.origin !== origin || !["/setup", `/api/me/profile/identities/${provider}/start`, path, "/me/profile"].includes(url.pathname)) {
          if (url.origin === origin && url.pathname === "/favicon.ico" && !url.search) return route.fulfill({ status: 204 });
          externalBrowserRequests++; return route.abort();
        }
        if (url.pathname === "/setup") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Hermetic setup</title>" });
        if (url.pathname === "/me/profile") return route.fulfill({ contentType: "text/html", headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }, body: "<!doctype html><title>Return complete</title>" });
        const body = incoming.postDataBuffer();
        const request = new Request(incoming.url(), { method: incoming.method(), headers: browserHeaders, ...(body?.length ? { body: new Uint8Array(body) } : {}) });
        const strict = !!uniqueIdentityCookieValue(request, "keryx_session");
        const hasFlow = !!uniqueIdentityCookieValue(request, identityCookieName(provider));
        const hasContinuation = !!uniqueIdentityCookieValue(request, identityContinuationCookieName(provider));
        // Retained logs are bounded booleans and fixed paths; no URLs, query values, headers, tokens or provider data.
        assert(logs.length < 16); logs.push({ path: url.pathname, method: incoming.method(), query: !!url.search, strict, flow: hasFlow, continuation: hasContinuation });
        const beforeReads = sessionReads;
        let response: Response;
        if (url.pathname.endsWith("/start")) {
          response = await storage.run(request, () => routes.START(request, provider)); assert.equal(response.status, 200);
          const startBody = await response.clone().json(); state = new URL(startBody.authorizationUrl).searchParams.get("state")!;
          originalFlow = response.headers.getSetCookie().find(cookie => cookie.startsWith(`${identityCookieName(provider)}=`))!.split(";")[0];
          const flow = await readIdentityFlow(originalFlow.slice(originalFlow.indexOf("=") + 1), secret, Date.now()); assert(flow);
          assert.equal(flow.sessionHash, currentId); expectedVerifier = flow.codeVerifier;
        } else if (incoming.method() === "GET") {
          response = await storage.run(request, () => routes.CALLBACK(request, provider));
          assert.equal(sessionReads, beforeReads); assert.equal(exchanges, 0);
          if (url.search) {
            externalGetObserved = true; assert.equal(strict, false, "REAL Chromium omits Strict on cross-site callback"); assert(hasFlow, "REAL Chromium sends Lax flow");
            assert.equal(response.status, 303); assert.equal(response.headers.get("location"), callback);
            continuation = response.headers.getSetCookie()[0].split(";")[0];
            assert(response.headers.getSetCookie()[0].includes("HttpOnly; Secure; SameSite=Lax; Max-Age=60"));
          } else {
            documents++; assert.equal(response.status, 200); assert(hasFlow && hasContinuation);
            assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
            assert.equal(response.headers.get("x-frame-options"), "DENY"); assert(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
            const html = await response.clone().text(); assert(html.includes(`method="post" action="${path}"`));
            for (const privateValue of ["hermetic-code", state, issued.token, originalFlow, continuation, "hermetic-private-detail"]) assert(!html.includes(privateValue));
            // Between external staging and the same-origin POST, apply genuine refusal controls.
            if (mode === "missing") await context.clearCookies({ name: "keryx_session" });
            if (mode === "replaced") {
              const replacement = await issueWebSession(db, secret, wallet, "asker");
              await context.addCookies([{ name: "keryx_session", value: replacement.token, url: origin, httpOnly: true, secure: true, sameSite: "Strict" }]);
            }
            if (mode === "revoked") await db.revokeWebSession(currentId, wallet);
          }
        } else {
          assert.equal(incoming.method(), "POST"); assert.equal(url.search, ""); assert.equal(browserHeaders.origin, origin);
          assert.equal(browserHeaders.referer, callback, "Only the committed queryless same-origin callback is a referrer");
          assert.equal(body?.length ?? 0, 0); assert.equal(documents, 1, "POST follows committed actual GET document");
          if (mode !== "missing") assert(strict, "REAL same-origin form POST sends Strict session");
          postObserved = true; response = await storage.run(request, () => routes.CALLBACK_POST(request, provider));
          const successful = mode === "auto" || mode === "manual";
          assert.equal(response.headers.get("location"), `${origin}/me/profile?identity=${successful ? "verified" : "failed"}`);
          assert.equal(response.headers.getSetCookie().length, 2); assert(response.headers.getSetCookie().every(cookie => cookie.includes("Max-Age=0")));
          // Reuse captured ciphertext internally to prove durable replay refusal, never log it.
          const replay = await storage.run(request, () => routes.CALLBACK_POST(request.clone(), provider));
          assert.equal(replay.headers.get("location"), `${origin}/me/profile?identity=failed`);
        }
        return fulfill(route, response);
      };
      // Playwright user routing continues redirect requests outside its handler. Own
      // Fetch interception keeps EVERY real browser request, including 303 follow-ups,
      // on this hermetic transport without replacing redirects or cookie decisions.
      transport.on("Fetch.requestPaused", async event => {
        const incoming = event.request;
        const headers = Object.fromEntries(Object.entries(incoming.headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
        const route: ReturnTransport = {
          request: () => ({ url: () => incoming.url, method: () => incoming.method,
            allHeaders: async () => headers, postDataBuffer: () => incoming.postData === undefined ? null : Buffer.from(incoming.postData) }),
          fulfill: async options => {
            const body = Buffer.from(options.body ?? "");
            const responseHeaders = Object.entries(options.headers ?? {}).flatMap(([name, value]) =>
              name.toLowerCase() === "set-cookie" ? value.split("\n").map(value => ({ name, value })) : [{ name, value }]);
            if (options.contentType) responseHeaders.push({ name: "content-type", value: options.contentType });
            if (!responseHeaders.some(header => header.name.toLowerCase() === "content-length")) responseHeaders.push({ name: "content-length", value: String(body.length) });
            await transport.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: options.status ?? 200,
              responseHeaders, body: body.toString("base64") });
          },
          abort: async () => { await transport.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }); },
        };
        try { await handle(route); }
        catch (error) {
          transportFailure ??= error;
          await transport.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" }).catch(() => {});
        }
      });
      await transport.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
      const browserErrors: { kind: "console" | "page"; csp?: boolean; form?: boolean; script?: boolean; name?: string }[] = [];
      page.on("console", message => { if (message.type() === "error" && browserErrors.length < 8) {
        const text = message.text(); browserErrors.push({ kind: "console", csp: /Content.?Security.?Policy/i.test(text), form: /form/i.test(text), script: /script/i.test(text) });
      } });
      page.on("pageerror", error => { if (browserErrors.length < 8) browserErrors.push({ kind: "page", name: error.name.slice(0, 40) }); });
      await page.goto(`${origin}/setup`);
      if (mode === "manual") {
        // JS-disabled setup invokes actual START using the same genuinely issued
        // session seeded in Chromium. The return GET/document/form still run in Chromium.
        const start = new Request(`${origin}/api/me/profile/identities/${provider}/start`, { method: "POST", headers: {
          Origin: origin, "X-Keryx-Expected-Wallet": wallet, Cookie: `keryx_session=${issued.token}`,
        } });
        const response = await storage.run(start, () => routes.START(start, provider)); assert.equal(response.status, 200);
        state = new URL((await response.json()).authorizationUrl).searchParams.get("state")!;
        originalFlow = response.headers.getSetCookie()[0].split(";")[0];
        const flowToken = originalFlow.slice(originalFlow.indexOf("=") + 1), flow = await readIdentityFlow(flowToken, secret, Date.now()); assert(flow);
        expectedVerifier = flow.codeVerifier;
        await context.addCookies([{ name: identityCookieName(provider), value: flowToken, url: origin, httpOnly: true, secure: true, sameSite: "Lax" }]);
      } else {
        const status = await page.evaluate(async input => (await fetch(input.url, { method: "POST", headers: { "X-Keryx-Expected-Wallet": input.wallet } })).status,
          { url: `${origin}/api/me/profile/identities/${provider}/start`, wallet });
        assert.equal(status, 200);
      }
      await page.goto(`${providerOrigin}/consent`);
      await page.getByRole("link", { name: "Return to Keryx" }).click();
      if (mode === "manual") {
        await page.getByRole("button", { name: "Continue", exact: true }).waitFor(); assert.equal(page.url(), callback);
        assert.equal(exchanges, 0); await page.getByRole("button", { name: "Continue", exact: true }).click();
      }
      try { await page.waitForURL(origin + "/me/profile?identity=*"); }
      catch (error) {
        const current = new URL(page.url());
        const facts = await page.evaluate(() => {
          const form = document.querySelector("form");
          return { readyState: document.readyState, title: document.title.slice(0, 128), hasForm: form !== null,
            formMethod: form?.getAttribute("method") ?? null, formPath: form ? new URL(form.action).pathname : null,
            scriptCount: document.scripts.length, mainText: document.querySelector("main")?.textContent?.slice(0, 512) ?? null };
        }).catch(() => ({ documentUnavailable: true }));
        process.stderr.write(JSON.stringify({ diagnostic: "identity-return-navigation", provider, mode, path: current.pathname,
          queryKeys: [...current.searchParams.keys()], documents, sessionReads, exchanges, externalGetObserved, postObserved,
          completedCases: results.length, logs, browserErrors, facts }) + "\n");
        throw transportFailure ?? error;
      }
      if (transportFailure) throw transportFailure;
      assert(externalGetObserved && postObserved); assert.equal(documents, 1);
      const admittedExchange = ["auto", "manual", "unlink-inflight"].includes(mode);
      assert.equal(exchanges, admittedExchange ? 1 : 0);
      const cookies = await context.cookies(origin);
      assert(!cookies.some(cookie => cookie.name === identityCookieName(provider) || cookie.name === identityContinuationCookieName(provider)));
      if (["auto", "manual", "revoked", "denied", "unlink-inflight"].includes(mode))
        assert.deepEqual(cookies.find(cookie => cookie.name === "keryx_session"), initialSessionCookie, "Strict session cookie unchanged by callback");
      const identities = (await requireProfileIdentities(db).list(wallet)).identities;
      if (mode === "auto" || mode === "manual") assert(identities.some(identity => identity.provider === provider));
      // Back navigation must never commit the provider query as a Keryx document/history entry.
      const cdp = await context.newCDPSession(page), history = await cdp.send("Page.getNavigationHistory");
      for (const entry of history.entries) if (new URL(entry.url).origin === origin && new URL(entry.url).pathname === path) assert.equal(new URL(entry.url).search, "");
      await cdp.detach();
      assert.equal(forbiddenFetches, 0); assert.equal(externalBrowserRequests, 0);
      results.push({ provider, mode, exchanges, documents, externalGetOmittedStrict: true, sameOriginPost: true, durableSession: true, replayRefused: true, logs });
      await requireProfileIdentities(db).unlink(wallet, provider);
    } finally { await context.close(); }
  }
  assert.equal(forbiddenFetches, 0); assert.equal(externalBrowserRequests, 0);
  process.stdout.write(JSON.stringify({ scope: "Hermetic real Chromium + actual routes + genuine temporary SQLite sessions; fake provider exchange only; no live OAuth", results }) + "\n");
} finally {
  globalThis.fetch = originalFetch;
  await browser?.close(); db.close();
  const target = resolve(root);
  assert(target.startsWith(resolve(tmpdir()) + sep) && target.includes("keryx-identity-oauth-return-"), "Bounded fixture cleanup");
  await rm(target, { recursive: true, force: true });
}
