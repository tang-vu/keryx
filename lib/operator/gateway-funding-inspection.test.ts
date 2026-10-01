import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction } from "viem";
import { canonicalJson } from "../canonical-json";
import { provisionSyntheticStorage } from "../db/storage-identity-fixture";
import { scanFullStorageSnapshot } from "../db/storage-identity-snapshot";
import { storageIdentityDigest } from "../db/storage-identity";
import { inspectGatewayFundingSqliteOwnerTarget, installGatewayFundingSqliteOwnerPolicy, installGatewayFundingSqliteOwnerAuthorization,
  openGatewayFundingSqliteLedger, openGatewayFundingSqliteTerminalObserver } from "../db/gateway-funding-sqlite";
import { syntheticFundingTerminal } from "../db/gateway-funding-sqlite-test-receipt";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "../payments/gateway-funding-receipt-policy";
import { inspectGatewayFundingSqliteOperation, inspectGatewayFundingSqliteOperationForTrustedSyntheticComposition } from "./gateway-funding-inspection";
import { validateGatewayFundingOperationLocator, type GatewayFundingOperationLocator } from "../payments/gateway-funding-operation-locator";

const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const directories: string[] = [];
let httpCalls = 0, responseValue: unknown, onAvailability: (() => void | Promise<void>) | undefined;
const server = createServer(async (req, res) => {
  let text = ""; for await (const chunk of req) text += chunk.toString(); httpCalls++;
  expect(req.method).toBe("POST"); expect(req.url).toBe("/v1/balances");
  expect(JSON.parse(text)).toEqual({ token: "USDC", sources: [{ depositor: f.operation.policy.spend, domain: 26 }] });
  expect(req.headers.authorization).toBeUndefined(); await onAvailability?.(); res.setHeader("Connection", "close"); res.end(JSON.stringify(responseValue));
});
let endpoint: string;
async function fixture(finalized = true) {
  const dir = mkdtempSync(join(tmpdir(), "funding-inspection-")); directories.push(dir);
  const file = resolve(join(dir, "application.sqlite")), identity = await provisionSyntheticStorage(file, "testnet-real"), spend = privateKeyToAccount(generatePrivateKey());
  const policy = { format: "gateway-funding-policy-v1" as const, identity, policyId: randomUUID(), funder: `0x${"1".repeat(40)}`, spend: spend.address.toLowerCase(),
    lifetimeLimits: { nativeWei: "100", usdcMicros: "200", depositMicros: "200", gasWei: "800" }, maxTransactionGas: "10", maxFeePerGasWei: "20" };
  await installGatewayFundingSqliteOwnerPolicy(file, identity, { format: "gateway-funding-owner-installation-v1", policy,
    funderGasBudgetWei: "400", spendGasBudgetWei: "400", ...await inspectGatewayFundingSqliteOwnerTarget(file, identity), finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST,
    history: { format: "gateway-funding-empty-isolated-history-v1", documentDigest: "d".repeat(64), funderInitialNonce: "0", spendInitialNonce: "0" } });
  const operation = { format: "gateway-funding-operation-v1" as const, policy, operationId: randomUUID(), ownerAuthorizationId: randomUUID(), ownerAuthorizationDigest: "b".repeat(64),
    minimumAvailableMicros: "100", initialAvailableMicros: "0", nativeTransferWei: "50", usdcTransferMicros: "100", approvalMicros: "100", depositMicros: "100",
    gasLimits: { nativeTransfer: "10", usdcTransfer: "10", approval: "10", deposit: "10" }, maxFeePerGasWei: "10", maxPriorityFeePerGasWei: "1" };
  await installGatewayFundingSqliteOwnerAuthorization(file, identity, operation);
  const writer = openGatewayFundingSqliteLedger(file, identity);
  try {
    await writer.admitOperation(operation.operationId);
    if (finalized) {
      const slot = await writer.reserveStep(operation.operationId, "deposit", "0"), claim = randomUUID(); await writer.claimCrypto(operation.operationId, "deposit", claim);
      const rawTransaction = await spend.signTransaction(parseTransaction(slot.transaction.serializedUnsigned));
      await writer.savePrepared(operation.operationId, "deposit", claim, { rawTransaction, transactionHash: keccak256(rawTransaction) });
      await writer.claimBroadcast(operation.operationId, "deposit", randomUUID()); const original = await writer.inspectReservation(operation.operationId, "deposit");
      const observer = openGatewayFundingSqliteTerminalObserver(file, identity); try {
        await observer.appendVerifiedTerminalObservation(operation.operationId, "deposit", await syntheticFundingTerminal(original!));
      } finally { observer.close(); }
    }
    const ns = await writer.inspectNamespace(policy.spend), storage = { format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } };
    const proof: GatewayFundingOperationLocator = { format: "keryx-funding-operation-locator-v1", storageManifestDigest: digest(storage), identityDigest: storageIdentityDigest(identity),
      operationId: operation.operationId, installedPolicyDigest: digest(policy), backendBindingDigest: ns.backendBindingDigest, finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST };
    const storageManifestPath = join(dir, "storage.json"), operationManifestPath = join(dir, "operation.json");
    writeFileSync(storageManifestPath, canonicalJson(storage)); writeFileSync(operationManifestPath, canonicalJson(proof));
    const snapshot = () => { const db = new DatabaseSync(file, { readOnly: true }); try { return scanFullStorageSnapshot(db); } finally { db.close(); } };
    return { file, dir, operation, storage, proof, snapshot, storageManifestPath, operationManifestPath };
  } finally { writer.close(); }
}
let f: Awaited<ReturnType<typeof fixture>>, missing: typeof f;
const require = createRequire(import.meta.url), tsx = pathToFileURL(require.resolve("tsx")).href;
async function subprocess(args: string[], input?: unknown, splitAt?: number) {
  const child = spawn(process.execPath, ["--import", tsx, ...args], { windowsHide: true, stdio: "pipe", env: process.platform === "win32" ? { NODE_ENV: "production", SystemRoot: process.env.SystemRoot } : { NODE_ENV: "production" } });
  return await new Promise<{ code: number | null; stdout: string; stderr: string; diagnostic: string }>(resolve => {
    let stdout = "", stderr = "", timedOut = false, errorCode = "none";
    const deadline = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 35000);
    child.once("error", error => {
      const code = (error as NodeJS.ErrnoException).code;
      errorCode = ["ENOENT", "EACCES", "EPERM", "ENOMEM", "EAGAIN"].includes(code ?? "") ? code! : "other";
    });
    child.stdout.on("data", chunk => { stdout += chunk.toString(); }); child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.once("close", (code, signal) => {
      clearTimeout(deadline);
      const safeSignal = signal === null ? "none" : ["SIGKILL", "SIGTERM", "SIGABRT", "SIGSEGV", "SIGILL", "SIGBUS"].includes(signal) ? signal : "other";
      const diagnostic = `phase=child-close status=${typeof code === "number" ? code : "none"} signal=${safeSignal} error=${errorCode} deadline=${timedOut}`;
      resolve({ code, stdout, stderr, diagnostic });
    });
    const wire = input ? Buffer.from(JSON.stringify(input)) : undefined;
    if (wire && splitAt !== undefined) { child.stdin.write(wire.subarray(0, splitAt)); setTimeout(() => child.stdin.end(wire.subarray(splitAt)), 100); }
    else child.stdin.end(wire);
  });
}
const cliPath = fileURLToPath(new URL("../../scripts/funding-inspect.mts", import.meta.url));
const cli = (which = f, extra: string[] = []) => subprocess([cliPath, "--storage-manifest", which.storageManifestPath, "--operation-manifest", which.operationManifestPath, ...extra]);
const options = (which = f) => ({ storageManifestPath: which.storageManifestPath, operationManifestPath: which.operationManifestPath, currentAvailability: false });
async function syntheticAvailability() {
  const moduleUrl = new URL("./gateway-funding-inspection.ts", import.meta.url).href;
  const script = `const loaded=await import(${JSON.stringify(moduleUrl)});
    const inspect=loaded.inspectGatewayFundingSqliteOperationForTrustedSyntheticComposition??loaded.default?.inspectGatewayFundingSqliteOperationForTrustedSyntheticComposition;
    if(typeof inspect!=='function')throw new Error('Synthetic inspection module unavailable');
    let wire='';for await(const chunk of process.stdin)wire+=chunk.toString();const request=JSON.parse(wire);
    try{process.stdout.write(JSON.stringify(await inspect(request.options,request.endpoint)));}catch{process.stderr.write('Funding inspection unavailable; private details omitted');process.exitCode=1;}`;
  return await subprocess(["--input-type=module", "-e", script], { options: { ...options(), currentAvailability: true }, endpoint });
}
function privateFree(wire: string) { for (const secret of [f.file, f.dir, f.operation.policy.spend, f.operation.policy.funder, "rawTransaction", "ownerAuthorizationDigest", "transactionHash"]) expect(wire).not.toContain(secret); expect(Buffer.byteLength(wire)).toBeLessThanOrEqual(8192); }
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error();
  endpoint = `http://127.0.0.1:${address.port}/v1/balances`; f = await fixture(); missing = await fixture(false);
}, 30000);
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); directories.forEach(dir => rmSync(dir, { recursive: true, force: true })); });
describe("explicit keyless funding inspection command", () => {
  it("runs actual native parent/child CLI network-free with unchanged main-file bytes/full state and redacted retained summaries", async () => {
    const bytes = readFileSync(f.file), snapshot = f.snapshot(), before = httpCalls, result = await cli(); expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout); expect(report).toMatchObject({ status: "inspected-originals", readOnly: true, signingResumeAuthorized: false, steps: { deposit: "finalized-success" }, availability: { status: "not-requested" } });
    expect(report.namespaces[1]).toMatchObject({ nextReservedNonce: "1", nextCryptoNonce: "1", retainedExposure: { depositMicros: "100" } });
    privateFree(result.stdout); expect(httpCalls).toBe(before); expect(readFileSync(f.file)).toEqual(bytes); expect(f.snapshot()).toEqual(snapshot);
  });
  it("does not infer readiness from missing original even when explicitly requested", async () => {
    const bytes = readFileSync(missing.file), snapshot = missing.snapshot(), result = await cli(missing, ["--current-availability"]);
    expect(result.code).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ steps: { deposit: "not-reserved" }, availability: { status: "unknown" } });
    expect(readFileSync(missing.file)).toEqual(bytes); expect(missing.snapshot()).toEqual(snapshot);
  });
  it("uses explicit trusted synthetic native subprocess availability, never a production CLI endpoint override", async () => {
    const moduleUrl = new URL("./gateway-funding-inspection.ts", import.meta.url).href;
    const probe = await subprocess(["--input-type=module", "-e", `import {inspectGatewayFundingSqliteOperationForTrustedSyntheticComposition as inspect} from ${JSON.stringify(moduleUrl)};process.stdout.write(typeof inspect);`]);
    if (probe.code !== 0) {
      expect(probe.code, `phase=named-export-probe ${probe.diagnostic}`).toBe(1); expect(probe.stderr.includes("does not provide an export named"), `phase=named-export-fallback ${probe.diagnostic}`).toBe(true);
      console.info("Synthetic fixture static named export unavailable; normalized dynamic export required");
    } else { expect(probe.code).toBe(0); expect(probe.stdout).toBe("function"); }
    const bytes = readFileSync(f.file), snapshot = f.snapshot();
    for (const available of ["0.000100", "0.000099"]) {
      responseValue = { token: "USDC", balances: [{ depositor: f.operation.policy.spend, domain: 26, balance: available }] };
      const result = await syntheticAvailability(); expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout).availability).toEqual(available === "0.000100" ? { status: "observed-available-meets-minimum", availableMicros: "100", minimumAvailableMicros: "100" } : { status: "unknown" }); privateFree(result.stdout);
    }
    expect(readFileSync(f.file)).toEqual(bytes); expect(f.snapshot()).toEqual(snapshot);
    const rejected = await cli(f, ["--endpoint", endpoint]); expect(rejected.code).toBe(1); expect(rejected.stdout).toBe("");
  }, 20000);
  it("refuses changed exact operation/backend/storage/policy/finality bindings without modifying the application file", async () => {
    const bytes = readFileSync(f.file), snapshot = f.snapshot();
    try {
      for (const changed of [{ operationId: randomUUID() }, { backendBindingDigest: "e".repeat(64) }, { identityDigest: "e".repeat(64) }, { installedPolicyDigest: "e".repeat(64) }, { finalityPolicyDigest: "e".repeat(64) }, { storageManifestDigest: "e".repeat(64) }]) {
        writeFileSync(f.operationManifestPath, canonicalJson({ ...f.proof, ...changed })); const result = await cli(); expect(result.code).toBe(1); expect(result.stdout).toBe(""); privateFree(result.stderr);
      }
    } finally { writeFileSync(f.operationManifestPath, canonicalJson(f.proof)); }
    expect(readFileSync(f.file)).toEqual(bytes); expect(f.snapshot()).toEqual(snapshot);
  }, 20000);
  it("refuses noncanonical/duplicate/unknown/oversized manifest inputs and never echoes private payloads", async () => {
    const bytes = readFileSync(f.file), snapshot = f.snapshot(), original = canonicalJson(f.proof);
    try {
      for (const wire of [JSON.stringify(f.proof, null, 2), original.replace('{', '{"operationId":"private-sentinel",'), canonicalJson({ ...f.proof, privateKey: "private-sentinel" }), "\ufeff" + original, " ".repeat(8193)]) {
        writeFileSync(f.operationManifestPath, wire); const result = await cli(); expect(result.code).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("private-sentinel"); privateFree(result.stderr);
      }
    } finally { writeFileSync(f.operationManifestPath, original); }
    expect(readFileSync(f.file)).toEqual(bytes); expect(f.snapshot()).toEqual(snapshot);
  }, 20000);
  it("rejects missing target/relative arguments/duplicate flags without any automatic store or manifest creation", async () => {
    const target = join(f.dir, "never-created.sqlite"), manifest = join(f.dir, "never-created.json");
    expect((await subprocess([cliPath, "--storage-manifest", manifest, "--operation-manifest", f.operationManifestPath])).code).toBe(1);
    expect(existsSync(manifest)).toBe(false); expect(existsSync(target)).toBe(false);
    expect((await subprocess([cliPath, "--storage-manifest", "storage.json", "--operation-manifest", f.operationManifestPath])).code).toBe(1);
    expect((await cli(f, ["--operation-manifest", f.operationManifestPath])).code).toBe(1);
  });
  it("rejects malformed helper options and has no implicit environment-selected default target", async () => {
    await expect(inspectGatewayFundingSqliteOperation({ ...options(), currentAvailability: "1" as unknown as boolean })).rejects.toThrow();
    expect((await subprocess([cliPath])).code).toBe(1);
  });
  it("treats the pure shared locator as copied descriptive metadata, rejecting accessors and old unshipped format", () => {
    const copied = validateGatewayFundingOperationLocator(f.proof); expect(copied).toEqual(f.proof); expect(Object.isFrozen(copied)).toBe(true);
    expect(() => validateGatewayFundingOperationLocator({ ...f.proof, format: "keryx-funding-inspection-v1" })).toThrow();
    let touched = false; const accessor = { ...f.proof }; Object.defineProperty(accessor, "operationId", { enumerable: true, get: () => { touched = true; return f.proof.operationId; } });
    expect(() => validateGatewayFundingOperationLocator(accessor)).toThrow(); expect(touched).toBe(false);
  });
  it("refuses missing database, non-SQLite/offline/foreign storage without automatic creation or fallback", async () => {
    const target = join(f.dir, "never-created.sqlite"), bytes = readFileSync(f.file), snapshot = f.snapshot();
    const candidates = [{ ...f.storage, backend: { kind: "sqlite", databasePath: target } }, { ...f.storage, backend: { kind: "supabase", url: "https://example.invalid" } },
      { ...f.storage, identity: { ...f.storage.identity, authorityMode: "testnet-offline" } }, { ...f.storage, identity: { ...f.storage.identity, deploymentId: randomUUID() } }];
    try {
      for (const storage of candidates) {
        writeFileSync(f.storageManifestPath, canonicalJson(storage)); writeFileSync(f.operationManifestPath, canonicalJson({ ...f.proof, storageManifestDigest: digest(storage) }));
        const result = await cli(); expect(result.code).toBe(1); expect(result.stdout).toBe(""); expect(existsSync(target)).toBe(false); privateFree(result.stderr);
      }
    } finally { writeFileSync(f.storageManifestPath, canonicalJson(f.storage)); writeFileSync(f.operationManifestPath, canonicalJson(f.proof)); }
    expect(readFileSync(f.file)).toEqual(bytes); expect(f.snapshot()).toEqual(snapshot);
  }, 20000);
  it("rechecks explicit manifests after HTTP and refuses changed authority before publishing availability", async () => {
    const bytes = readFileSync(f.file), snapshot = f.snapshot(); responseValue = { token: "USDC", balances: [{ depositor: f.operation.policy.spend, domain: 26, balance: "0.000100" }] };
    onAvailability = () => writeFileSync(f.operationManifestPath, canonicalJson({ ...f.proof, installedPolicyDigest: "e".repeat(64) }));
    try { const result = await syntheticAvailability(); expect(result.code).toBe(1); expect(result.stdout).toBe(""); privateFree(result.stderr); }
    finally { onAvailability = undefined; writeFileSync(f.operationManifestPath, canonicalJson(f.proof)); }
    expect(readFileSync(f.file)).toEqual(bytes); expect(f.snapshot()).toEqual(snapshot);
  });
  it("decodes split multibyte canonical manifest paths once after native child stdin EOF", async () => {
    const storageManifestPath = join(f.dir, "\u50a8\u5b58.json"), operationManifestPath = join(f.dir, "\u64cd\u4f5c.json");
    writeFileSync(storageManifestPath, canonicalJson(f.storage)); writeFileSync(operationManifestPath, canonicalJson(f.proof));
    const request = { storageManifestPath, operationManifestPath, currentAvailability: false }, wire = Buffer.from(JSON.stringify(request));
    const splitAt = wire.indexOf(Buffer.from("\u50a8")) + 1, bytes = readFileSync(f.file), snapshot = f.snapshot();
    const childPath = fileURLToPath(new URL("../../scripts/funding-inspect-child.mts", import.meta.url));
    const result = await subprocess([childPath], request, splitAt); expect(result.code).toBe(0); privateFree(result.stdout);
    expect(JSON.parse(result.stdout).availability.status).toBe("not-requested"); expect(readFileSync(f.file)).toEqual(bytes); expect(f.snapshot()).toEqual(snapshot);
  });
  it("copies helper options before awaits so caller mutation cannot change paths or requested observation", async () => {
    const request = { ...options(), currentAvailability: true }, bytes = readFileSync(f.file), snapshot = f.snapshot();
    responseValue = { token: "USDC", balances: [{ depositor: f.operation.policy.spend, domain: 26, balance: "0.000100" }] };
    onAvailability = () => { request.currentAvailability = false; request.storageManifestPath = "missing"; request.operationManifestPath = "missing"; };
    try { const result = await inspectGatewayFundingSqliteOperationForTrustedSyntheticComposition(request, endpoint); expect(result.availability.status).toBe("observed-available-meets-minimum"); }
    finally { onAvailability = undefined; }
    expect(readFileSync(f.file)).toEqual(bytes); expect(f.snapshot()).toEqual(snapshot);
  });
  it("refuses assembled snapshot drift from an actual native concurrent writer without adding inspection writes", async () => {
    const before = f.snapshot(); let writerSnapshot: unknown, writerBytes: Buffer | undefined;
    responseValue = { token: "USDC", balances: [{ depositor: f.operation.policy.spend, domain: 26, balance: "0.000100" }] };
    onAvailability = async () => {
      const writer = openGatewayFundingSqliteLedger(f.file, f.storage.identity);
      try { await writer.reserveStep(f.operation.operationId, "nativeTransfer", "0"); } finally { writer.close(); }
      writerSnapshot = f.snapshot(); writerBytes = readFileSync(f.file);
    };
    try { const result = await syntheticAvailability(); expect(result.code).toBe(1); expect(result.stdout).toBe(""); privateFree(result.stderr); }
    finally { onAvailability = undefined; }
    expect(writerSnapshot).toBeDefined(); expect(writerSnapshot).not.toEqual(before); expect(f.snapshot()).toEqual(writerSnapshot); expect(readFileSync(f.file)).toEqual(writerBytes);
  });

});
