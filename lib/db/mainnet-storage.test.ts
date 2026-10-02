import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { STORAGE_MAINNET_PROFILE_DIGEST, validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { createSqliteStorage, enrollSqliteStorage } from "./storage-identity-provision";
import type { BrowserJournalAdmission } from "./browser-authorization-journal";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function fixture() {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-mainnet-storage-")), file = join(folder, "fresh.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
    network: ARC_MAINNET_PROFILE.networkId, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST,
    deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(),
    provenanceDigest: "11".repeat(32) };
  await createSqliteStorage(file, identity);
  const manifestPath = join(folder, "storage.json");
  writeFileSync(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  vi.stubEnv("BASE_URL", "https://keryx.cc");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`);
  const adapter = await (await import("./index")).getDb();
  cleanup.push(() => { if ("close" in adapter) (adapter.close as () => void)(); });
  return { adapter, file, identity, manifestPath };
}
it("uses a fresh native mainnet namespace and atomically retains its own nonce/cap history", async () => {
  const { adapter, file } = await fixture();
  await adapter.activateBrowserJournal();
  const owner = "0x1111111111111111111111111111111111111111", signer = "0x2222222222222222222222222222222222222222";
  const payee = "0x3333333333333333333333333333333333333333", grantEpoch = randomUUID();
  await adapter.upsertSessionGrant({ sessionId: owner, ownerAddr: owner, sessAddr: signer, grantEpoch,
    cap: 0.001, expiry: Date.now() + 60_000, txHash: "synthetic-test-no-funds" });
  const input: BrowserJournalAdmission = { sessionId: owner, signer, grantEpoch, requestId: randomUUID(), queryId: randomUUID(),
    sourceId: "synthetic-source", offerId: null, kind: "fetch", payee, amountMicroUsdc: 1000,
    network: ARC_MAINNET_PROFILE.networkId, token: ARC_MAINNET_PROFILE.usdcAddress, gatewayContract: ARC_MAINNET_PROFILE.gatewayWallet,
    requirements: { scheme: "exact", network: ARC_MAINNET_PROFILE.networkId, asset: ARC_MAINNET_PROFILE.usdcAddress,
      payTo: payee, amount: "1000", maxTimeoutSeconds: 604900, extra: { name: "GatewayWalletBatched", version: "1",
        verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet } },
    payment: { kind: "fetch", queryId: "", sourceId: "synthetic-source", sourceName: "Synthetic source",
      payer: signer, payee, amountUsdc: 0.001, network: ARC_MAINNET_PROFILE.networkId, grantEpoch } };
  input.payment.queryId = input.queryId;
  const admitted = await adapter.admitBrowserJournal(input);
  expect(admitted.status).toBe("admitted");
  await expect(adapter.admitBrowserJournal({ ...input, requestId: randomUUID(), network: ARC_TESTNET_PROFILE.networkId,
    gatewayContract: ARC_TESTNET_PROFILE.gatewayWallet })).rejects.toThrow();
  expect((await adapter.admitBrowserJournal({ ...input, requestId: randomUUID() })).status).toBe("grant_or_cap_refused");
  expect((await adapter.getSessionGrant(owner))!.spent).toBe(0.001);
  const native = new DatabaseSync(file);
  try {
    expect(native.prepare("SELECT count(*) AS n FROM browser_authorization_intents").get()?.n).toBe(1);
    expect(native.prepare("SELECT network FROM browser_authorization_intents").get()?.network).toBe(ARC_MAINNET_PROFILE.networkId);
    expect(native.prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?").get(signer)?.spent_micro).toBe(1000);
  } finally { native.close(); }
}, 30000);
it("consumes an exact owner-signed funded consent once across two native connections and retains proof after expiry", async () => {
  const { adapter, file } = await fixture();
  const { config } = await import("../config");
  const { privateKeyToAccount } = await import("viem/accounts");
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), session = privateKeyToAccount(`0x${"22".repeat(32)}`), signer = session.address.toLowerCase();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://gateway-api.circle.com/v1/balances");
    expect(JSON.parse(String(init.body))).toEqual({ token: "USDC", sources: [{ depositor: signer, domain: 26 }] });
    return Response.json({ token: "USDC", balances: [{ depositor: signer, domain: 26, balance: "1.000000", pending: "0" }] });
  }));
  const service = await import("../payments/mainnet-session-grants"), { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage } = await import("../payments/session-grant-consent");
  const { consent } = await service.issueMainnetSessionGrant(adapter, owner.address, { sessAddr: signer, budgetMicros: "500000" });
  const signature = await owner.signMessage({ message: createSessionGrantConsentMessage(consent, config.profile) });
  const sessionSignature = await session.signMessage({ message: createSessionGrantSignerProofMessage(consent, config.profile) });
  const second = await (await import("./enrolled-sqlite-adapter")).createEnrolledSqliteAdapter();
  cleanup.push(() => second.close());
  const attacker = privateKeyToAccount(`0x${"44".repeat(32)}`);
  const { consent: foreign } = await service.issueMainnetSessionGrant(adapter, attacker.address, { sessAddr: signer, budgetMicros: "500000" });
  const attackerSignature = await attacker.signMessage({ message: createSessionGrantConsentMessage(foreign, config.profile) });
  const fakePossession = await attacker.signMessage({ message: createSessionGrantSignerProofMessage(foreign, config.profile) });
  await expect(service.consumeMainnetSessionGrant(adapter, attacker.address, { consent: foreign, signature: attackerSignature, sessionSignature: fakePossession }))
    .rejects.toThrow("Session signer possession proof refused");
  expect(await adapter.getSessionGrant(attacker.address.toLowerCase())).toBeNull();
  await expect(service.consumeMainnetSessionGrant(adapter, attacker.address, { consent: foreign, signature: attackerSignature, sessionSignature }))
    .rejects.toThrow("Session signer possession proof refused");
  await service.consumeMainnetSessionGrant(adapter, owner.address, { consent, signature, sessionSignature });
  await expect(service.consumeMainnetSessionGrant(second, owner.address, { consent, signature, sessionSignature })).rejects.toThrow();
  const grant = (await second.getSessionGrant(owner.address.toLowerCase()))!;
  expect(grant.grantEpoch).toBe(consent.grantEpoch); expect(grant.cap).toBe(0.5);
  await expect(service.consumeMainnetSessionGrant(second, signer, { consent, signature, sessionSignature })).rejects.toThrow();
  await expect(service.consumeMainnetSessionGrant(second, owner.address, { consent: { ...consent, capMicroUsdc: "999999" }, signature, sessionSignature })).rejects.toThrow();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Number(consent.expirySeconds) * 1000 + 1);
  await second.deleteExpiredSessionGrants(Date.now());
  expect(await second.getSessionGrantConsent(owner.address.toLowerCase(), consent.grantEpoch)).toEqual({ consent, ownerSignature: signature, sessionSignature });
  const native = new DatabaseSync(file);
  try {
    expect(() => native.prepare("DELETE FROM session_grant_consents").run()).toThrow();
    expect(native.prepare("SELECT count(*) AS n FROM browser_retained_grants").get()?.n).toBe(1);
  } finally { native.close(); }
}, 30000);
it("refuses adopting, reusing or relabelling mainnet storage as testnet", async () => {
  const { file, identity } = await fixture();
  await expect(createSqliteStorage(file, identity)).rejects.toThrow();
  await expect(enrollSqliteStorage(file, identity, {} as never)).rejects.toThrow();
  for (const mutation of [{ format: "keryx-storage-identity-v1" }, { authorityMode: "testnet-real" },
    { network: ARC_TESTNET_PROFILE.networkId }, { profileDigest: "22".repeat(32) }])
    expect(() => validateStorageIdentity({ ...identity, ...mutation })).toThrow();
}, 30000);
it("refuses mainnet without a sealed manifest before creating a legacy database", async () => {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-mainnet-no-fallback-")), file = join(folder, "legacy.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", undefined); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`);
  const { getDb } = await import("./index");
  await expect(getDb()).rejects.toThrow("Storage deployment configuration unavailable");
  expect(existsSync(file)).toBe(false);
});
it("closes the initialized application facade when its pinned manifest changes", async () => {
  const { adapter, manifestPath, identity, file } = await fixture();
  writeFileSync(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1",
    identity: { ...identity, storageId: randomUUID() }, backend: { kind: "sqlite", databasePath: file } }));
  await expect(Promise.resolve().then(() => adapter.listSources())).rejects.toThrow();
  const native = new DatabaseSync(file);
  try { expect(native.prepare("SELECT count(*) AS n FROM sources").get()?.n).toBe(0); } finally { native.close(); }
}, 30000);
it("refuses forcing sealed real mainnet storage offline before application writes", async () => {
  const { adapter, file } = await fixture();
  vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
  const { readRuntimeStorageDeployment } = await import("./runtime-storage-config");
  expect(() => readRuntimeStorageDeployment()).toThrow("Storage deployment configuration unavailable");
  await expect(Promise.resolve().then(() => adapter.listSources())).rejects.toThrow();
  const native = new DatabaseSync(file);
  try { expect(native.prepare("SELECT count(*) AS n FROM sources").get()?.n).toBe(0); } finally { native.close(); }
}, 30000);
it("serves the normal owner consent and exact live admitted item challenge through actual handlers", async () => {
  const { adapter } = await fixture();
  const { privateKeyToAccount } = await import("viem/accounts"), { NextRequest } = await import("next/server");
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), session = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const wallet = owner.address.toLowerCase(), signer = session.address.toLowerCase();
  vi.doMock("../account-sessions", () => ({ accountSessionContext: async () => ({ db: adapter, wallet }) }));
  vi.doMock("../auth", () => ({ getSession: async () => ({ address: wallet }) }));
  cleanup.push(() => { vi.doUnmock("../account-sessions"); vi.doUnmock("../auth"); });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ token: "USDC", balances: [{ depositor: signer, domain: 26, balance: "1" }] })));
  const challengeRoute = await import("../../app/api/session/grant/challenge/route"), grantRoute = await import("../../app/api/session/grant/route");
  const request = (path: string, body: unknown, origin = "https://keryx.cc") => new NextRequest(`https://keryx.cc${path}`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect((await challengeRoute.POST(request("/api/session/grant/challenge", { sessAddr: signer, budgetMicros: "500000" }, "https://foreign.example"))).status).toBe(403);
  const issued = await challengeRoute.POST(request("/api/session/grant/challenge", { sessAddr: signer, budgetMicros: "500000" }));
  expect(issued.status).toBe(200);
  const { consent } = await issued.json(), { config } = await import("../config");
  const messages = await import("../payments/session-grant-consent");
  const signature = await owner.signMessage({ message: messages.createSessionGrantConsentMessage(consent, config.profile) });
  const sessionSignature = await session.signMessage({ message: messages.createSessionGrantSignerProofMessage(consent, config.profile) });
  expect((await grantRoute.POST(request("/api/session/grant", { consent, signature, sessionSignature }))).status).toBe(200);
  expect((await grantRoute.POST(request("/api/session/grant", { consent, signature, sessionSignature }))).status).toBe(409);
  const status = await (await grantRoute.GET(new NextRequest("https://keryx.cc/api/session/grant"))).json();
  expect(status).toMatchObject({ active: true, sessionId: wallet, ownerAddr: wallet, sessAddr: signer, network: "eip155:5042",
    origin: "https://keryx.cc", capMicroUsdc: "500000", consent, ownerSignature: signature, sessionSignature });
  const reqId = randomUUID(), queryId = randomUUID(), payee = `0x${"33".repeat(20)}`;
  const item = { itemId: "one", itemTitle: "Exact encrypted evidence", itemUrl: "https://source.example/item",
    contentVersion: `sha256:${"44".repeat(32)}`, contentReceipt: { deliveryKind: "full_text" as const, storageMode: "db_encrypted" as const,
      plaintextBytes: 42, bodyHash: `0x${"55".repeat(32)}` } };
  const requirements = { scheme: "exact", network: config.profile.networkId, asset: config.profile.usdcAddress,
    payTo: payee, amount: "500000", maxTimeoutSeconds: 604900, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: config.profile.gatewayWallet } };
  const admission = await adapter.admitBrowserJournal({ sessionId: wallet, requestId: reqId, queryId, grantEpoch: consent.grantEpoch,
    signer, network: config.profile.networkId, token: config.profile.usdcAddress, gatewayContract: config.profile.gatewayWallet,
    sourceId: "synthetic-source", offerId: null, kind: "fetch", payee, amountMicroUsdc: 500000, requirements, paymentContext: { item },
    payment: { queryId, sourceId: "synthetic-source", sourceName: "Source", kind: "fetch", payer: signer, payee,
      amountUsdc: 0.5, network: config.profile.networkId, grantEpoch: consent.grantEpoch, ...item } });
  if (admission.status !== "admitted") throw new Error("Synthetic admission refused");
  await adapter.exposeBrowserJournal(wallet, reqId);
  const { awaitSignature, cancelPending } = await import("../payments/pending-signatures");
  const pending = awaitSignature(wallet, reqId, { requirements, expectedSigner: signer, expectedNonce: admission.journal.nonce }).catch(() => undefined);
  cleanup.push(() => cancelPending(wallet, reqId));
  const paymentRoute = await import("../../app/api/ask/challenge/route");
  const response = await paymentRoute.POST(request("/api/ask/challenge", { reqId }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sessionId: wallet, reqId, grantEpoch: consent.grantEpoch, sessAddr: signer,
    sourceId: "synthetic-source", kind: "fetch", expectedNonce: admission.journal.nonce, browserAuthorizationProtocol: "durable-v1",
    requirements, paymentContext: { item } });
  expect((await paymentRoute.POST(request("/api/ask/challenge", { reqId, sourceId: "invented" }))).status).toBe(400);
  cancelPending(wallet, reqId); await pending;
  expect((await paymentRoute.POST(request("/api/ask/challenge", { reqId }))).status).toBe(409);
  expect((await adapter.getSessionGrant(wallet))!.spent).toBe(0.5);
  // Synthetic terminal evidence updates native accounting; no live facilitator or funds.
  expect(await adapter.settlePendingPayment(admission.journal.payment.id!, admission.journal.nonce, "synthetic-confirmed-transfer")).toBe(true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ token: "USDC", balances: [{ depositor: signer, domain: 26, balance: "0.5" }] })));
  const renewal = await (await challengeRoute.POST(request("/api/session/grant/challenge", { sessAddr: signer, budgetMicros: "500000", recover: true }))).json();
  expect(renewal.consent.capMicroUsdc).toBe("1000000");
  expect(renewal.funding).toEqual({ availableMicroUsdc: "500000", confirmedSpentMicroUsdc: "500000",
    retainedSpentMicroUsdc: "500000", proposedRemainingMicroUsdc: "500000" });
  const renewedSignature = await owner.signMessage({ message: messages.createSessionGrantConsentMessage(renewal.consent, config.profile) });
  const renewedSessionSignature = await session.signMessage({ message: messages.createSessionGrantSignerProofMessage(renewal.consent, config.profile) });
  const renewed = await grantRoute.POST(request("/api/session/grant", { consent: renewal.consent, signature: renewedSignature, sessionSignature: renewedSessionSignature }));
  expect(renewed.status).toBe(200); expect((await renewed.json()).spentMicroUsdc).toBe("500000");
  const unknownId = randomUUID(), unknown = await adapter.admitBrowserJournal({ sessionId: wallet, requestId: unknownId, queryId,
    grantEpoch: renewal.consent.grantEpoch, signer, network: config.profile.networkId, token: config.profile.usdcAddress,
    gatewayContract: config.profile.gatewayWallet, sourceId: "synthetic-source", offerId: null, kind: "fetch", payee,
    amountMicroUsdc: 100000, requirements: { ...requirements, amount: "100000" }, paymentContext: { item },
    payment: { queryId, sourceId: "synthetic-source", sourceName: "Source", kind: "fetch", payer: signer, payee,
      amountUsdc: 0.1, network: config.profile.networkId, grantEpoch: renewal.consent.grantEpoch, ...item } });
  expect(unknown.status).toBe("admitted"); await adapter.exposeBrowserJournal(wallet, unknownId);
  const heldProposal = await (await challengeRoute.POST(request("/api/session/grant/challenge", { sessAddr: signer, budgetMicros: "500000", recover: true }))).json();
  expect(heldProposal.consent.capMicroUsdc).toBe("1000000");
  expect(heldProposal.funding).toEqual({ availableMicroUsdc: "500000", confirmedSpentMicroUsdc: "500000",
    retainedSpentMicroUsdc: "600000", proposedRemainingMicroUsdc: "400000" });
  expect((await (await grantRoute.GET(new NextRequest("https://keryx.cc/api/session/grant"))).json()).spentMicroUsdc).toBe("600000");
  expect((await adapter.getBrowserJournal(wallet, unknownId))!.phase).toBe("exposed");
  expect((await grantRoute.POST(request("/api/session/grant", { consent, signature, sessionSignature }))).status).toBe(409);
  expect((await adapter.getSessionGrant(wallet))!.grantEpoch).toBe(renewal.consent.grantEpoch);
}, 30000);
