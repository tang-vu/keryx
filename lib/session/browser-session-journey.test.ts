import { afterEach, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright";
import { encodeFunctionResult, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../db/storage-identity";
import { createSqliteStorage } from "../db/storage-identity-provision";
import type { QueryRun } from "../types";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.doUnmock("next/headers"); vi.doUnmock("@circle-fin/x402-batching/server");
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

/** Production composition is intact: native sealed DB, JWT/row auth, normal handlers, SSE,
 * runAgent, BrowserCoSignGateway, paid encrypted seller and actual browser worker/IndexedDB.
 * Only Next's request cookie accessor and external RPC/Circle transport are synthetic. */
it.each([false, true])("completes a normal mainnet cited answer with citation failure=%s", async failCitation => {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-browser-mainnet-journey-")), databasePath = join(folder, "fresh.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
    network: profile.networkId, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(),
    enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
  await createSqliteStorage(databasePath, identity);
  const manifest = join(folder, "storage.json");
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath } }));
  const origin = "https://keryx.cc", registry = `0x${"33".repeat(20)}` as Hex;
  for (const [name, value] of Object.entries({ KERYX_NETWORK: "arc", NEXT_PUBLIC_KERYX_NETWORK: "arc", KERYX_FORCE_OFFLINE: "0",
    KERYX_STORAGE_MANIFEST: manifest, KERYX_SQLITE_PATH: databasePath, CONTENT_MASTER_KEY: randomBytes(32).toString("hex"),
    KERYX_REGISTRY_ADDRESS: registry, NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: registry, BASE_URL: origin, JWT_SECRET: randomBytes(32).toString("hex") })) vi.stubEnv(name, value);
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), creator = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const cookies = new AsyncLocalStorage<string | undefined>();
  vi.doMock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "keryx_session" && cookies.getStore() ? { value: cookies.getStore() } : undefined }) }));
  const settledNonces = new Set<string>(); let sessionAddress = "", circleDebit = BigInt(0);
  vi.doMock("@circle-fin/x402-batching/server", () => ({ BatchFacilitatorClient: class {
    constructor(options: { url: string }) { expect(options.url).toBe(profile.gatewayApiUrl); }
    async verify(payload: { payload: { authorization: { from: string; nonce: string }; signature: string } }, requirements: import("../payments/browser-cosign-gateway").PaymentRequirements) {
      const { verifyBrowserSignature } = await import("../payments/verify-browser-signature");
      await verifyBrowserSignature(Buffer.from(JSON.stringify(payload.payload)).toString("base64"), { requirements, expectedSigner: sessionAddress, expectedNonce: payload.payload.authorization.nonce });
      return { isValid: true, payer: sessionAddress };
    }
    async settle(payload: { resource: { url: string }; payload: { authorization: { nonce: string; value: string } } }) {
      if (failCitation && payload.resource.url.includes("/api/cite/")) return { success: false, errorReason: "synthetic citation failure" };
      expect(settledNonces.has(payload.payload.authorization.nonce)).toBe(false);
      settledNonces.add(payload.payload.authorization.nonce); circleDebit += BigInt(payload.payload.authorization.value);
      return { success: true, payer: sessionAddress, transaction: `synthetic-circle-${settledNonces.size}`, network: profile.networkId };
    }
  } }));
  const { getDb } = await import("../db"), db = await getDb(); cleanup.push(() => (db as unknown as { close(): void }).close());
  await db.activateBrowserJournal();
  const { sourceId: deriveSourceId, REGISTRY_ABI } = await import("../registry/registry-client");
  const source = { id: "normal-mainnet-source", name: "Durable payment nonce protection", url: "https://creator.example", description: "Durable reservations protect payment nonces",
    tags: ["payment", "nonces", "reservations"], walletAddress: creator.address, authors: [{ name: "Creator", walletAddress: creator.address, splitWeight: 1 }],
    fetchPrice: 0.001, createdAt: new Date().toISOString(), verified: true, active: true, onchainId: deriveSourceId(creator.address, "https://creator.example") };
  await db.upsertSource(source);
  const body = "Durable reservations protect payment nonces by recording every nonce before a signature is exposed. Unknown payment authorizations retain capacity until confirmed settlement evidence resolves them.";
  const { storeSourceItem } = await import("../sources/store-source-item");
  await db.addItems([await storeSourceItem({ id: "normal-article", sourceId: source.id, title: source.name, summary: "Nonce reservations protect payments", content: body,
    link: `${source.url}/article`, publishedAt: new Date().toISOString(), deliveryKind: "full_text" }, { localOnly: true, requireEncrypted: true })]);
  const { issueWebSession } = await import("../auth-session"), { config } = await import("../config");
  const { token } = await issueWebSession(db, config.jwtSecret, owner.address.toLowerCase(), "asker");
  const { NextRequest } = await import("next/server");
  const grantChallenge = await import("../../app/api/session/grant/challenge/route"), grant = await import("../../app/api/session/grant/route");
  const challenge = await import("../../app/api/ask/challenge/route"), sign = await import("../../app/api/ask/sign/route"), ask = await import("../../app/api/ask/route");
  const sourceIndex = await import("../../app/api/sources/route"), preview = await import("../../app/api/source/[id]/item/[itemId]/preview/route");
  const credit = await import("../../app/api/session/credit/route"), revoke = await import("../../app/api/session/revoke/route");
  const seller = await import("../../app/api/source/[id]/item/[itemId]/route"), cite = await import("../../app/api/cite/[id]/route");
  async function dispatch(url: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("host")) headers.set("host", "keryx.cc");
    if (!headers.has("origin")) headers.set("origin", origin);
    const req = new NextRequest(url, { ...init, signal: init.signal ?? undefined, headers });
    return cookies.run(cookie, async () => {
      const path = req.nextUrl.pathname;
      if (path === "/api/session/grant/challenge") return grantChallenge.POST(req);
      if (path === "/api/session/grant") return init.method === "POST" ? grant.POST(req) : grant.GET(req);
      if (path === "/api/session/credit") return credit.GET(req);
      if (path === "/api/session/revoke") return revoke.POST(req);
      if (path === "/api/ask/challenge") return challenge.POST(req);
      if (path === "/api/ask/sign") return sign.POST(req);
      if (path === "/api/ask") return ask.POST(req);
      if (path === "/api/sources") return sourceIndex.GET(req);
      if (path.startsWith("/api/cite/")) return cite.POST(req, { params: Promise.resolve({ id: source.id }) });
      const ctx = { params: Promise.resolve({ id: source.id, itemId: "normal-article" }) };
      if (path.endsWith("/preview")) return preview.GET(req, ctx);
      if (path.startsWith("/api/source/")) return seller.GET(req, ctx);
      throw new Error(`Unexpected synthetic handler path ${path}`);
    });
  }
  const blockHash = `0x${"66".repeat(32)}`;
  async function rpc(input: RequestInit) {
    const request = JSON.parse(String(input.body)) as { id: number; method: string };
    const result = request.method === "eth_chainId" ? profile.chainIdHex : request.method === "eth_getBlockByNumber"
      ? { number: "0x64", hash: blockHash, timestamp: "0x64", transactions: [], gasLimit: "0x1000000", gasUsed: "0x0", baseFeePerGas: "0x1" }
      : request.method === "eth_call" ? encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", result: {
        creator: creator.address, payoutWallet: creator.address, authors: [{ wallet: creator.address, basisPoints: 10000 }], fetchPriceUsdc6: BigInt(1000), contentCid: "", tags: "", active: true } }) : null;
    if (result === null) throw new Error(`Unexpected synthetic RPC method ${request.method}`);
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  }
  vi.stubGlobal("fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
    const target = String(url);
    if (target.startsWith(profile.rpcUrl)) return rpc(init);
    if (target === config.gatewayBalanceApi) {
      const requested = JSON.parse(String(init.body));
      sessionAddress ||= requested.sources[0].depositor.toLowerCase();
      return Response.json({ token: "USDC", balances: [{ depositor: sessionAddress, domain: profile.cctpDomain, balance: (Number(BigInt(1_000_000)-circleDebit)/1e6).toFixed(6) }] });
    }
    if (target.startsWith(origin)) return dispatch(target, init);
    throw new Error("Unexpected external network refused");
  });
  const worker = await build({ entryPoints: ["lib/session/mainnet-session-signer.worker.ts"], platform: "browser", bundle: true, write: false,
    define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"', "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" } });
  const hook = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {useMainnetSessionGrant} from './lib/hooks/use-mainnet-session-grant';
    window.wallet={account:{address:'${owner.address}'},getChainId:async()=>5042,getAddresses:async()=>['${owner.address}'],signMessage:async({message})=>window.ownerPersonalSign(message)};
    function Probe(){const grant=useMainnetSessionGrant(); window.normalGrant=grant;return <output id="state">{JSON.stringify(grant.state)}</output>}
    createRoot(document.getElementById('root')).render(<Probe/>);
  ` }, bundle: true, write: false, platform: "browser", format: "esm",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
    plugins: [{ name: "synthetic-owner-wallet", setup(builder) {
      builder.onResolve({ filter: /^wagmi$/ }, () => ({ path: "wagmi", namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "const rpc={};export const useWalletClient=()=>({data:window.wallet});export const usePublicClient=()=>rpc;export const useSwitchChain=()=>({switchChainAsync:async()=>{}});" }));
    } }] });
  const browser = await chromium.launch({ headless: true }); cleanup.push(() => browser.close());
  const context = await browser.newContext(); await context.addCookies([{ name: "keryx_session", value: token, url: origin, secure: true, httpOnly: true, sameSite: "Strict" }]);
  await context.exposeFunction("ownerPersonalSign", (message: string) => owner.signMessage({ message }));
  let holdGrant = false, holdRevoke = false, releaseHeld: (() => void) | undefined, held = false;
  await context.route("**/*", async route => {
    const req = route.request(), url = req.url();
    if (url === `${origin}/`) return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script type="module" src="/hook.js"></script>' });
    if (url === `${origin}/hook.js`) return route.fulfill({ contentType: "application/javascript", body: hook.outputFiles[0].text });
    if (url === `${origin}/worker.js` || url === `${origin}/mainnet-session-signer.worker.ts`) return route.fulfill({ contentType: "application/javascript", body: worker.outputFiles[0].text });
    if (url.startsWith(profile.rpcUrl)) { const response = await rpc({ body: req.postData() }); return route.fulfill({ status: response.status, body: await response.text(), contentType: "application/json" }); }
    expect(url.startsWith(origin)).toBe(true);
    const receivedToken = req.headers().cookie?.split(";").map(s => s.trim()).find(s => s.startsWith("keryx_session="))?.slice("keryx_session=".length);
    if (holdRevoke && url === `${origin}/api/session/revoke`) { holdRevoke = false; held = true; await new Promise<void>(resolve => { releaseHeld = resolve; }); }
    const response = await dispatch(url, { method: req.method(), body: req.postData() ?? undefined, headers: req.headers() }, receivedToken);
    if (holdGrant && req.method() === "GET" && url === `${origin}/api/session/grant`) { holdGrant = false; held = true; await new Promise<void>(resolve => { releaseHeld = resolve; }); }
    return route.fulfill({ status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers) });
  });
  const page = await context.newPage(); await page.goto(origin);
  await page.waitForFunction(() => !!(window as unknown as { normalGrant?: unknown }).normalGrant);
  await page.evaluate(() => (window as unknown as { normalGrant: { generateAndFund(budget: number): Promise<void> } }).normalGrant.generateAndFund(0.05));
  const hookState = async () => JSON.parse((await page.locator("#state").textContent())!);
  expect(await hookState()).toMatchObject({ status: "active", cap: 0.05, spent: 0 });
  expect((await hookState()).sessAddr.toLowerCase()).toBe(sessionAddress);
  await page.evaluate(() => {
    const worker = new Worker("/worker.js"), pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>(); let id = 0;
    worker.onmessage = ({ data }) => { const slot = pending.get(data.id); if (!slot) return; pending.delete(data.id); if (data.ok) slot.resolve(data.result); else slot.reject(new Error(data.error)); };
    (window as unknown as { call(type: string, fields?: object): Promise<unknown> }).call = (type, fields = {}) => new Promise((resolve, reject) => { const seq = ++id; pending.set(seq, { resolve, reject }); worker.postMessage({ id: seq, type, ...fields }); });
  });
  const call = (type: string, fields: object = {}) => page.evaluate(({ type, fields }) => (window as unknown as { call(type: string, fields: object): Promise<unknown> }).call(type, fields), { type, fields });
  await call("initializeOwner", { owner: owner.address });
  expect((await call("restoreRetained") as { address: string }).address.toLowerCase()).toBe(sessionAddress);
  const { createSessionGrantConsentMessage } = await import("../payments/session-grant-consent");
  const response = await dispatch(`${origin}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "How do durable reservations protect payment nonces?", budget: 0.01, sessionId: owner.address, browserAuthorizationProtocol: "durable-v1", mode: "quick", scholarly: false }) }, token);
  expect(response.status).toBe(200); const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = "", done: QueryRun | null = null, signs = 0;
  for (;;) {
    const next = await reader.read(); if (next.done) break; buffer += decoder.decode(next.value, { stream: true });
    while (buffer.includes("\n\n")) {
      const end = buffer.indexOf("\n\n"), packet = buffer.slice(0, end); buffer = buffer.slice(end+2);
      const event = /^event: (.+)$/m.exec(packet)?.[1], data = JSON.parse(/^data: (.+)$/m.exec(packet)![1]);
      if (event === "error") throw new Error(JSON.stringify(data));
      if (event === "sign-request") {
        signs++; const { paymentHeader } = await call("authorizePayment", { reqId: data.reqId, question: { id: identity.enrollmentId, budgetMicroUsdc: "10000" } }) as { paymentHeader: string };
        const status = await page.evaluate(async ({ reqId, paymentHeader, sessionId }) => (await fetch("/api/ask/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, reqId, paymentHeader }) })).status, { reqId: data.reqId, paymentHeader, sessionId: owner.address.toLowerCase() });
        expect(status).toBe(200);
      }
      if (event === "done") done = data;
    }
  }
  expect(done).not.toBeNull(); expect(done!.answer).toContain("[S1]"); expect(done!.answer).toContain("nonce"); expect(done!.citations.length).toBeGreaterThan(0);
  expect(signs).toBe(2); expect(settledNonces.size).toBe(failCitation ? 1 : 2);
  const payments = await db.listCreatorPaymentAttemptsByQuery(done!.id);
  expect(payments.find(p => p.kind === "fetch")?.settled).toBe(true);
  expect(payments.some(p => p.kind === "citation" && p.settled)).toBe(!failCitation);
  expect(await db.getQueryRun(done!.id)).not.toBeNull();
  if (!failCitation) {
    const renew = async () => {
      const proposal = await dispatch(`${origin}/api/session/grant/challenge`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessAddr: sessionAddress, budgetMicros: "50000", recover: true }) }, token);
      expect(proposal.status).toBe(200);
      const { consent } = await proposal.json();
      const signature = await owner.signMessage({ message: createSessionGrantConsentMessage(consent, config.profile) });
      const sessionSignature = await call("signGrantConsentProof", { consent, ownerSignature: signature });
      const accepted = await dispatch(`${origin}/api/session/grant`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent, signature, sessionSignature }) }, token);
      expect(accepted.status).toBe(200); const metadata = await accepted.json();
      expect(metadata.capMicroUsdc).toBe(consent.capMicroUsdc);
      expect(BigInt(metadata.spentMicroUsdc)).toBeGreaterThan(BigInt(0));
      return metadata;
    };
    const recover = () => page.evaluate(() => (window as unknown as { normalGrant: { tryRecover(): Promise<boolean> } }).normalGrant.tryRecover());
    held = false; holdGrant = true; const oldPublication = recover();
    await expect.poll(() => held).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" })));
    releaseHeld!(); await oldPublication;
    expect((await hookState()).status).toBe("paused");
    expect((await hookState()).grantEpoch).toBeNull();

    // An older metadata response cannot publish after another tab replaces the exact proof.
    held = false; holdGrant = true; const replacedPublication = recover();
    await expect.poll(() => held).toBe(true); const replacement = await renew();
    releaseHeld!(); await replacedPublication;
    expect((await hookState()).status).toBe("paused");
    await recover(); await expect.poll(hookState).toMatchObject({ status: "active", grantEpoch: replacement.grantEpoch });
    expect((await hookState()).spent).toBe(Number(replacement.spentMicroUsdc)/1e6);

    // Old logout reaches the server only after a newer grant: CAS must preserve the newer epoch.
    held = false; holdRevoke = true;
    const delayedLogout = page.evaluate(() => (window as unknown as { normalGrant: { revoke(): Promise<unknown> } }).normalGrant.revoke());
    await expect.poll(() => held).toBe(true); const afterLogout = await renew();
    releaseHeld!(); await delayedLogout;
    expect((await hookState()).status).toBe("paused");
    expect((await (await dispatch(`${origin}/api/session/grant`, {}, token)).json()).grantEpoch).toBe(afterLogout.grantEpoch);
    await recover(); await expect.poll(hookState).toMatchObject({ status: "active", grantEpoch: afterLogout.grantEpoch });
  }
  await call("lock"); expect((await call("restoreRetained") as { address: string }).address.toLowerCase()).toBe(sessionAddress);
}, 60000);
