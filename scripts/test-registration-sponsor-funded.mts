/** Bounded real Arc TESTNET acceptance. Publisher claims are explicit local fixtures. */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { createPublicClient, http, keccak256, parseTransaction, toBytes, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { canonicalJson } from "../lib/canonical-json";
import { registrationId, confirmsRegistration } from "../lib/sources/registration-status";
import { registrationIntentDigest, registrationPolicyDigest, registrationSponsorPolicySchema, registrationTypedData,
  type SponsoredRegistration } from "../lib/sources/registration-sponsor-protocol";
import { sourceClaimSchema } from "../lib/sources/public-source-claim";
import { REGISTRY_ABI, REVISIONED_REGISTRY_ABI } from "../lib/registry/registry-abi";
import type { KeryxDB } from "../lib/db/keryx-db";
import type { RegistrationSponsorContext } from "../lib/sources/registration-sponsor-service";
import type { SourceRegistryAuthority } from "../lib/registry/source-registry-authority";
import { sourceInputs } from "../lib/evals/paying-source-study/source-inputs";

export const TESTNET_SPONSOR = "0x384462d9d8e2645a017e4ef34a0cdfd91b4b97cd" as const;
export const TESTNET_CREATOR = "0xc5965e3175ef063faeb8bcd3abe2d25b5d27d586" as const;
const ORIGIN = "https://registration-sponsor-funded.test.invalid";
const RPC = "https://rpc.testnet.arc.network";
export const FUNDED_SCENARIOS = ["normal", "authorization-interrupt", "raw-interrupt", "ack-lost", "expired-original"] as const;
export type FundedScenario = typeof FUNDED_SCENARIOS[number];
const scenarioSchema = z.enum(FUNDED_SCENARIOS);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/).transform(value => value as Hex);
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function fail(): never { throw new Error("Funded testnet acceptance refused; preserve original state"); }

/** The fifth attempt cannot increase the original 0.16 native test-USDC money cap. */
export const fundedFixturePolicySchema = z.object({
  format: z.literal("keryx-registration-sponsor-funded-acceptance-v1"), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  runId: z.string().uuid(), creator: z.literal(TESTNET_CREATOR), claimEvidence: z.literal("controlled-testnet-fixture"),
  sponsorKeyField: z.literal("AGENT_FUNDER_PRIVATE_KEY"), creatorKeyField: z.literal("SELLER_PRIVATE_KEY"),
  policy: registrationSponsorPolicySchema,
}).strict().refine(value => value.policy.network === "eip155:5042002" && value.policy.deploymentOrigin === ORIGIN &&
  value.policy.sponsorAddress === TESTNET_SPONSOR && canonicalJson(value.policy.allowlistedCreators) === canonicalJson([TESTNET_CREATOR]) &&
  value.policy.registryAddress === "0x75403cf34cedf107735209abdd1ecd111d5e10b3" &&
  value.policy.maxGas === 1_000_000 && value.policy.maxFeePerGasWei === "40000000000" && value.policy.maxTransactionWei === "40000000000000000" &&
  value.policy.maxDailyWei === "160000000000000000" && value.policy.maxLifetimeWei === "160000000000000000" &&
  value.policy.maxRegistrationsPerWallet === 5 && value.policy.maxRegistrationsPerDay === 5 && value.policy.maxRegistrationsTotal === 5,
"Exact bounded fixture policy required");
export type FundedFixturePolicy = z.infer<typeof fundedFixturePolicySchema>;
const sourceBindingSchema = z.object({ format: z.literal("keryx-funded-testnet-source-binding-v1"),
  headCommit: z.string().regex(/^[0-9a-f]{40}$/), trackedTree: z.string().regex(/^[0-9a-f]{40}$/),
  dirtyWorkingTree: z.boolean(), runtimeNode: z.string().max(64),
  files: z.record(z.string().min(1).max(512), z.string().regex(/^[0-9a-f]{64}$/)), digest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type FundedSourceBinding = z.infer<typeof sourceBindingSchema>;
export function captureFundedSourceBinding(): FundedSourceBinding {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const inputs = sourceInputs(root, fileURLToPath(import.meta.url));
  if (inputs.unresolved.length || Object.keys(inputs.files).length > 4096) fail();
  for (const name of ["package.json", "package-lock.json", "tsconfig.json"])
    inputs.files[name] = sha256(fs.readFileSync(join(root, name), "utf8").replaceAll("\r\n", "\n"));
  const git = (args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 262144 });
  const value = { format: "keryx-funded-testnet-source-binding-v1" as const, headCommit: git(["rev-parse", "HEAD"]).trim(),
    trackedTree: git(["rev-parse", "HEAD^{tree}"]).trim(), dirtyWorkingTree: !!git(["status", "--porcelain", "--untracked-files=all"]).trim(),
    runtimeNode: process.version, files: Object.fromEntries(Object.entries(inputs.files).sort(([a], [b]) => a.localeCompare(b, "en"))) };
  return sourceBindingSchema.parse({ ...value, digest: sha256(canonicalJson(value)) });
}
export function verifyFundedSourceBinding(bindingInput: FundedSourceBinding, observed = captureFundedSourceBinding()) {
  const binding = sourceBindingSchema.parse(bindingInput), { digest: retainedDigest, ...bound } = binding;
  if (retainedDigest !== sha256(canonicalJson(bound)) || binding.headCommit !== observed.headCommit ||
    binding.trackedTree !== observed.trackedTree || binding.runtimeNode !== observed.runtimeNode || canonicalJson(binding.files) !== canonicalJson(observed.files)) fail();
  return { declaredCommit: binding.headCommit, trackedTree: binding.trackedTree, exactSourceDigest: binding.digest,
    fileCount: Object.keys(binding.files).length, dirtyAtInitialization: binding.dirtyWorkingTree, currentDirtyWorkingTree: observed.dirtyWorkingTree,
    runtimeNode: binding.runtimeNode, acceptedCiClaimed: false };
}
export function fundedRegistryAuthority(manifest: FundedFixturePolicy): SourceRegistryAuthority {
  return { network: "eip155:5042002", address: manifest.policy.registryAddress, version: 3,
    codeHash: manifest.policy.registryCodeHash, deployBlock: "66758711" };
}

/** Existing Windows ACLs are checked; POSIX mode bits alone do not prove Windows privacy. */
export function assertFundedPrivatePath(path: string, directory: boolean) {
  if (!isAbsolute(path)) fail();
  const stat = fs.lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024)) fail();
  const real = fs.realpathSync(path), selected = resolve(path);
  if (process.platform === "win32" ? real.toLowerCase() !== selected.toLowerCase() : real !== selected) fail();
  if (process.platform === "win32") {
    const code = "$ErrorActionPreference='Stop';$i=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;" +
      "$a=Get-Acl -LiteralPath $env:KERYX_FUNDED_FIXTURE_ACL_TARGET;$r=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|Where-Object {$_.AccessControlType -eq 'Allow'});" +
      "$bad=@($r|Where-Object {$_.IdentityReference.Value -notin @($i,'S-1-5-18','S-1-5-32-544')});" +
      "@{owner=($a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $i);private=($bad.Count -eq 0);protected=$a.AreAccessRulesProtected;rules=$r.Count}|ConvertTo-Json -Compress";
    const proof = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", code], {
      windowsHide: true, timeout: 5000, maxBuffer: 16384, encoding: "utf8", env: { ...process.env, KERYX_FUNDED_FIXTURE_ACL_TARGET: path },
    }));
    if (!proof.owner || !proof.private || proof.rules < 1 || directory && !proof.protected) fail();
  } else if (!process.getuid || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) fail();
  return stat;
}
export function readFundedCustody(path: string) {
  assertFundedPrivatePath(dirname(path), true); assertFundedPrivatePath(path, false);
  const text = fs.readFileSync(path, "utf8"); if (text.length > 16_384) fail();
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || match[1] in values) fail(); values[match[1]] = match[2];
  }
  if (Object.keys(values).sort().join(",") !== "AGENT_FUNDER_PRIVATE_KEY,KERYX_NETWORK,NEXT_PUBLIC_KERYX_NETWORK,SELLER_PRIVATE_KEY" ||
    values.KERYX_NETWORK !== "arcTestnet" || values.NEXT_PUBLIC_KERYX_NETWORK !== "arcTestnet" ||
    !/^0x[0-9a-fA-F]{64}$/.test(values.AGENT_FUNDER_PRIVATE_KEY) || !/^0x[0-9a-fA-F]{64}$/.test(values.SELLER_PRIVATE_KEY)) fail();
  const sponsor = privateKeyToAccount(values.AGENT_FUNDER_PRIVATE_KEY as Hex), creator = privateKeyToAccount(values.SELLER_PRIVATE_KEY as Hex);
  if (sponsor.address.toLowerCase() !== TESTNET_SPONSOR || creator.address.toLowerCase() !== TESTNET_CREATOR) fail();
  return { sponsor, creator };
}

export function fundedCanonicalUrl(manifest: FundedFixturePolicy, scenario: FundedScenario) {
  return `${ORIGIN}/${manifest.runId}/${scenario}`;
}
export function fundedFixtureOriginal(manifest: FundedFixturePolicy, scenario: FundedScenario, nonce: bigint, now: number): SponsoredRegistration {
  const canonicalUrl = fundedCanonicalUrl(manifest, scenario), urlHash = keccak256(toBytes(canonicalUrl));
  const onchainId = registrationId(TESTNET_CREATOR, urlHash);
  const row: SponsoredRegistration = { id: `0x${"0".repeat(64)}`, policyDigest: registrationPolicyDigest(manifest.policy), creator: TESTNET_CREATOR,
    canonicalUrl, rssUrl: `${canonicalUrl}/rss.xml`, claimId: sha256(canonicalUrl), claimRevision: 1, sourceId: onchainId, onchainId,
    registryAddress: manifest.policy.registryAddress, registryCodeHash: manifest.policy.registryCodeHash, relayer: TESTNET_SPONSOR, chainId: 5042002,
    params: { urlHash, payoutWallet: TESTNET_CREATOR, authors: [{ wallet: TESTNET_CREATOR, basisPoints: 10000 }],
      fetchPriceUsdc6: "1000", contentCid: "", tags: "keryx-testnet-acceptance,fixture-publisher" }, nonce: nonce.toString(),
    deadline: Math.floor(Math.min(now + (scenario === "expired-original" ? 60_000 : 600_000), manifest.policy.expiresAt) / 1000),
    createdAt: now, updatedAt: now, reservedWei: manifest.policy.maxTransactionWei, state: "prepared" };
  row.id = registrationIntentDigest(row); return row;
}
export function fundedFixtureClaim(row: SponsoredRegistration, now: number) {
  return sourceClaimSchema.parse({ id: row.claimId, ownerWallet: row.creator, canonicalUrl: row.canonicalUrl, rssUrl: row.rssUrl,
    network: "eip155:5042002", deploymentOrigin: ORIGIN, registryAddress: row.registryAddress, verifiedAt: new Date(now).toISOString(),
    effectiveAt: new Date(now).toISOString(), revision: 1, linkedSourceId: row.sourceId, onchainId: row.onchainId,
    mode: "free", distributionPermission: false, proofMethod: "website-file" });
}

const SCHEMA = `CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
CREATE TABLE fixture_manifest(singleton INTEGER PRIMARY KEY CHECK(singleton=1),value TEXT NOT NULL) STRICT;
CREATE TRIGGER fixture_manifest_immutable BEFORE UPDATE ON fixture_manifest BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER fixture_manifest_retained BEFORE DELETE ON fixture_manifest BEGIN SELECT RAISE(ABORT,'retained'); END;
CREATE TABLE fixture_lock(singleton INTEGER PRIMARY KEY CHECK(singleton=1),pid INTEGER NOT NULL,host TEXT NOT NULL,scenario TEXT NOT NULL) STRICT;
CREATE TABLE fixture_events(sequence INTEGER PRIMARY KEY,scenario TEXT NOT NULL,phase TEXT NOT NULL,value TEXT NOT NULL) STRICT;
CREATE TRIGGER fixture_events_immutable BEFORE UPDATE ON fixture_events BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER fixture_events_retained BEFORE DELETE ON fixture_events BEGIN SELECT RAISE(ABORT,'retained'); END;
CREATE TABLE fixture_index(id TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;`;
export function initializeFundedFixture(db: DatabaseSync, manifest: FundedFixturePolicy, sourceBinding: FundedSourceBinding) {
  const parsed = fundedFixturePolicySchema.parse(manifest);
  db.exec("BEGIN IMMEDIATE");
  try { db.exec(SCHEMA); db.prepare("INSERT INTO fixture_manifest VALUES(1,?)").run(canonicalJson({ configuration: parsed,
    sourceBinding: sourceBindingSchema.parse(sourceBinding) })); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function acquireFundedFixtureLock(db: DatabaseSync, scenario: string, resume: boolean,
  pid = process.pid, host = hostname(), alive = (candidate: number) => {
    try { process.kill(candidate, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; return true; }
  }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = db.prepare("SELECT * FROM fixture_lock WHERE singleton=1").get();
    if (previous && (!resume || previous.host !== host || previous.scenario !== scenario || alive(Number(previous.pid)))) fail();
    db.prepare("INSERT INTO fixture_lock VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET pid=excluded.pid,host=excluded.host,scenario=excluded.scenario").run(pid, host, scenario);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
function event(db: DatabaseSync, scenario: string, phase: string, value: unknown) {
  db.prepare("INSERT INTO fixture_events(scenario,phase,value) VALUES(?,?,?)").run(scenario, phase, JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}
function selectRuntime(manifest: FundedFixturePolicy) {
  if ([process.env.KERYX_NETWORK, process.env.NEXT_PUBLIC_KERYX_NETWORK].some(value => value !== undefined && value !== "arcTestnet")) fail();
  if (process.env.KERYX_FORCE_OFFLINE === "1") fail();
  Object.assign(process.env, { KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_RPC_URL: RPC,
    KERYX_REGISTRY_ADDRESS: manifest.policy.registryAddress, NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: manifest.policy.registryAddress,
    KERYX_REGISTRY_READ_ADDRESS: manifest.policy.registryAddress, NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS: manifest.policy.registryAddress,
    KERYX_REGISTRY_VERSION: "3", NEXT_PUBLIC_KERYX_REGISTRY_VERSION: "3", KERYX_REGISTRY_DEPLOY_BLOCK: "66758711",
    KERYX_REGISTRY_ORIGINS: canonicalJson([fundedRegistryAuthority(manifest)]),
    NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS: canonicalJson([fundedRegistryAuthority(manifest)]), BASE_URL: ORIGIN });
}
async function storageFacade(native: DatabaseSync) {
  const core = await import("../lib/db/registration-sponsor");
  const origins = await import("../lib/db/source-registry-origin");
  const readIndex = async (id: string) => {
    const row = native.prepare("SELECT value FROM fixture_index WHERE id=?").get(id); if (!row) return null;
    const source = JSON.parse(String(row.value)), authority = origins.readSqliteSourceRegistryOrigin(native, id);
    if (!authority || canonicalJson(source.registryAuthority) !== canonicalJson(authority)) fail();
    return { ...source, registryAuthority: authority };
  };
  const db = { admitRegistrationSponsor: async (policy, row, now) => core.admitSqliteRegistrationSponsor(native, policy, row, now),
    getRegistrationSponsor: async input => core.getSqliteRegistrationSponsor(native, input),
    getRegistrationSponsorExecution: async input => core.getSqliteRegistrationSponsorExecution(native, input),
    transitionRegistrationSponsor: async input => core.transitionSqliteRegistrationSponsor(native, input),
    getSourceClaim: async id => { const row = native.prepare("SELECT value FROM sync_state WHERE key=?").get("keryx:source-claims:v1:claim:" + id); return row ? JSON.parse(String(row.value)) : null; },
    getSource: readIndex, getSourceByOnchainId: readIndex,
    getSourceMeta: async id => { const rows = native.prepare("SELECT value FROM sync_state WHERE key LIKE 'keryx:registration-sponsor:v1:row:%'").all();
      const original = rows.map(value => JSON.parse(String(value.value)).current as SponsoredRegistration).find(row => row.onchainId === id);
      return original ? { name: "Testnet fixture publisher", url: original.canonicalUrl, rssUrl: original.rssUrl,
        description: "Controlled acceptance fixture; no external publisher control evidence", registryAuthority: {
          network: "eip155:5042002" as const, address: original.registryAddress, version: 3 as const, codeHash: original.registryCodeHash, deployBlock: "66758711" } } : null; },
    upsertSource: async source => {
      if (!source.onchainId || !source.registryAuthority) fail(); native.exec("BEGIN IMMEDIATE");
      try { origins.bindSqliteSourceRegistryOrigin(native, source.onchainId, source.registryAuthority);
        native.prepare("INSERT INTO fixture_index VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(source.id, JSON.stringify(source)); native.exec("COMMIT"); }
      catch (error) { native.exec("ROLLBACK"); throw error; }
    },
    getSyncState: async key => { const value = native.prepare("SELECT value FROM sync_state WHERE key=?").get(key); return value ? String(value.value) : null; },
    setSyncState: async (key, value) => { native.prepare("INSERT INTO sync_state VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, value, new Date().toISOString()); },
  } satisfies Partial<KeryxDB>;
  return db as KeryxDB;
}

async function fixtureChain(manifest: FundedFixturePolicy, db: KeryxDB, native: DatabaseSync, scenario: FundedScenario,
  action: string, expectedNonce?: number, custody?: ReturnType<typeof readFundedCustody>): Promise<RegistrationSponsorContext["chain"]> {
  const client = createPublicClient({ chain: arcTestnet, transport: http(RPC, { timeout: 10_000, retryCount: 0 }) });
  const assertChain = async () => { if (await client.getChainId() !== 5042002) fail(); };
  const read = async <T,>(operation: () => Promise<T>) => { await assertChain(); const value = await operation(); await assertChain(); return value; };
  const row = () => db.getRegistrationSponsor!({ wallet: TESTNET_CREATOR, canonicalUrl: fundedCanonicalUrl(manifest, scenario) });
  async function nonce() {
    const [latest, pending] = await read(() => Promise.all([client.getTransactionCount({ address: TESTNET_SPONSOR, blockTag: "latest" }), client.getTransactionCount({ address: TESTNET_SPONSOR, blockTag: "pending" })]));
    if (latest !== pending || expectedNonce !== undefined && latest !== expectedNonce) fail(); return latest;
  }
  return { async assertRegistry() {
    const [code, version] = await read(() => Promise.all([client.getCode({ address: manifest.policy.registryAddress }),
      client.readContract({ address: manifest.policy.registryAddress, abi: REVISIONED_REGISTRY_ABI, functionName: "registryVersion" })]));
    if (!code || keccak256(code) !== manifest.policy.registryCodeHash || version !== 3) fail();
  }, registrationNonce: creator => read(() => client.readContract({ address: manifest.policy.registryAddress,
    abi: [{ type: "function", name: "registrationNonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "registrationNonces", args: [creator] })),
  transactionNonce: nonce, estimateGas: data => read(() => client.estimateGas({ account: TESTNET_SPONSOR, to: manifest.policy.registryAddress, data, value: BigInt(0) })),
  async sign(transaction) {
    if (!custody || transaction.nonce !== expectedNonce) fail(); await nonce();
    const original = await row(); if (!original || original.state !== "signing" || !await db.getRegistrationSponsorExecution!({ wallet: TESTNET_CREATOR, id: original.id })) fail();
    if (action === "start" && ["authorization-interrupt", "expired-original"].includes(scenario)) {
      event(native, scenario, "crash-before-signed-bytes", { id: original.id, nonce: original.transactionNonce, reservedWei: original.reservedWei }); process.exit(77);
    }
    event(native, scenario, "signing-original", { id: original.id, nonce: transaction.nonce }); return custody.sponsor.signTransaction(transaction);
  }, async broadcast(raw) {
    if (!custody) fail(); await nonce();
    const original = await row(), execution = original && await db.getRegistrationSponsorExecution!({ wallet: TESTNET_CREATOR, id: original.id });
    if (!original || original.state !== "submitted" || execution?.signedTransaction !== raw || keccak256(raw) !== original.transactionHash) fail();
    if (action === "start" && scenario === "raw-interrupt") {
      event(native, scenario, "crash-before-broadcast", { id: original.id, nonce: original.transactionNonce, transactionHash: original.transactionHash }); process.exit(78);
    }
    event(native, scenario, "broadcast-attempted", { id: original.id, nonce: original.transactionNonce, transactionHash: original.transactionHash });
    await assertChain(); const returned = await client.sendRawTransaction({ serializedTransaction: raw }); await assertChain();
    if (action === "start" && scenario === "ack-lost") {
      event(native, scenario, "crash-after-broadcast-before-ack", { id: original.id, transactionHash: returned }); process.exit(79);
    }
    return returned;
  }, async receipt(transactionHash) {
    try { return await read(() => client.getTransactionReceipt({ hash: transactionHash })); }
    catch (error) { if ((error as { name?: string }).name === "TransactionReceiptNotFoundError") return null; throw error; }
  }, hasExpiredDeadline: deadline => read(async () => { const block = await client.getBlock(); return block.timestamp > BigInt(deadline); }) };
}

async function observedReceipt(manifest: FundedFixturePolicy, native: DatabaseSync, row: SponsoredRegistration, receipt: TransactionReceipt) {
  if (receipt.transactionHash !== row.transactionHash || receipt.from.toLowerCase() !== TESTNET_SPONSOR || receipt.to?.toLowerCase() !== row.registryAddress ||
    receipt.gasUsed * receipt.effectiveGasPrice !== BigInt(row.actualGasWei!) || receipt.gasUsed * receipt.effectiveGasPrice > BigInt(row.reservedWei)) fail();
  const client = createPublicClient({ chain: arcTestnet, transport: http(RPC, { timeout: 10_000, retryCount: 0 }) });
  if (await client.getChainId() !== 5042002) fail();
  const transaction = await client.getTransaction({ hash: receipt.transactionHash });
  const core = await import("../lib/db/registration-sponsor"), execution = core.getSqliteRegistrationSponsorExecution(native, { wallet: TESTNET_CREATOR, id: row.id });
  if (!execution?.signedTransaction || keccak256(execution.signedTransaction) !== row.transactionHash || transaction.nonce !== row.transactionNonce || transaction.chainId !== 5042002) fail();
  const signed = parseTransaction(execution.signedTransaction);
  if (transaction.hash !== row.transactionHash || transaction.from.toLowerCase() !== TESTNET_SPONSOR || transaction.to?.toLowerCase() !== row.registryAddress ||
    transaction.input !== signed.data || transaction.value !== BigInt(0) || transaction.gas !== signed.gas || transaction.maxFeePerGas !== signed.maxFeePerGas ||
    transaction.maxPriorityFeePerGas !== signed.maxPriorityFeePerGas) fail();
  if (row.expiredResolution) {
    if (receipt.status !== "reverted" || confirmsRegistration(receipt, { registry: row.registryAddress, creator: TESTNET_CREATOR, onchainId: row.onchainId })) fail();
    const [absent, revision] = await client.readContract({ address: row.registryAddress, abi: REVISIONED_REGISTRY_ABI, functionName: "getWithRevision", args: [row.onchainId] });
    if (absent.creator !== `0x${"0".repeat(40)}` || revision !== BigInt(0)) fail();
  } else {
    if (!confirmsRegistration(receipt, { registry: row.registryAddress, creator: TESTNET_CREATOR, onchainId: row.onchainId })) fail();
    const [record, revision] = await client.readContract({ address: row.registryAddress, abi: REVISIONED_REGISTRY_ABI, functionName: "getWithRevision", args: [row.onchainId] });
    if (record.creator.toLowerCase() !== TESTNET_CREATOR || record.payoutWallet.toLowerCase() !== TESTNET_CREATOR || !record.active || revision !== BigInt(1) ||
      record.fetchPriceUsdc6 !== BigInt(row.params.fetchPriceUsdc6) || record.contentCid !== row.params.contentCid || record.tags !== row.params.tags ||
      record.authors.length !== 1 || record.authors[0].wallet.toLowerCase() !== TESTNET_CREATOR || record.authors[0].basisPoints !== 10000) fail();
    const logs = await client.getLogs({ address: row.registryAddress, events: REGISTRY_ABI.filter(item => item.type === "event"), fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
    await (await import("../lib/db/indexer")).applyLogs(logs, await storageFacade(native), fundedRegistryAuthority(manifest));
    const indexed = native.prepare("SELECT value FROM fixture_index WHERE id=?").get(row.onchainId);
    const sidecar = (await import("../lib/db/source-registry-origin")).readSqliteSourceRegistryOrigin(native, row.onchainId);
    if (!indexed || JSON.parse(String(indexed.value)).walletAddress.toLowerCase() !== TESTNET_CREATOR ||
      canonicalJson(JSON.parse(String(indexed.value)).registryAuthority) !== canonicalJson(fundedRegistryAuthority(manifest)) ||
      !sidecar || canonicalJson(sidecar) !== canonicalJson(fundedRegistryAuthority(manifest))) fail();
    // Real-node simulations, no extra edit transaction or creator gas spending.
    await client.simulateContract({ account: TESTNET_CREATOR, address: row.registryAddress, abi: REVISIONED_REGISTRY_ABI, functionName: "updatePrice", args: [row.onchainId, revision, BigInt(row.params.fetchPriceUsdc6)] });
    let sponsorEditRefused = false;
    try { await client.simulateContract({ account: TESTNET_SPONSOR, address: row.registryAddress,
      abi: [...REVISIONED_REGISTRY_ABI, { type: "error", name: "NotCreator", inputs: [] }], functionName: "updatePrice", args: [row.onchainId, revision, BigInt(row.params.fetchPriceUsdc6)] }); }
    catch (error) {
      for (let cause: unknown = error, depth = 0; cause && typeof cause === "object" && depth < 10; depth++) {
        const value = cause as { data?: { errorName?: string }; cause?: unknown };
        if (value.data?.errorName === "NotCreator") sponsorEditRefused = true; cause = value.cause;
      }
    } if (!sponsorEditRefused) fail();
  }
  await (await import("../lib/db/indexer")).syncOnce(await storageFacade(native));
  const checkpointKey = (await import("../lib/registry/source-registry-authority")).registryCheckpointKey(fundedRegistryAuthority(manifest));
  const checkpoint = native.prepare("SELECT value FROM sync_state WHERE key=?").get(checkpointKey);
  if (!checkpoint || BigInt(String(checkpoint.value)) < receipt.blockNumber || native.prepare("SELECT value FROM sync_state WHERE key='lastSyncedBlock'").get()) fail();
  if (await client.getChainId() !== 5042002) fail();
  event(native, FUNDED_SCENARIOS.find(scenario => fundedCanonicalUrl(manifest, scenario) === row.canonicalUrl)!, "independent-receipt-and-index", {
    transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice,
    actualGasWei: row.actualGasWei, status: receipt.status, creator: TESTNET_CREATOR, payoutWallet: TESTNET_CREATOR, sourceId: row.onchainId,
    nativeIndex: !row.expiredResolution, publisherControlEvidence: "controlled-testnet-fixture", creatorEditSimulation: !row.expiredResolution,
    registryAuthority: fundedRegistryAuthority(manifest), checkpointKey, checkpoint: String(checkpoint.value), singletonCheckpointImported: false,
  });
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "--help") {
    console.log("Bounded real TESTNET fixture acceptance; never mainnet, creates no wallet and never funds.\n" +
      "Actions: initialize, admit, start, resume, resolve-expired, reconcile, report.\n" +
      "All: --state-directory ABSOLUTE_PRIVATE_DIRECTORY. initialize: --policy ABS --policy-sha256 SHA --custody-env ABS.\n" +
      "admit: --scenario NAME. start/resume/resolve-expired: --scenario NAME --original-id HASH --expected-sponsor-nonce INTEGER --custody-env ABS.\n" +
      "reconcile: --scenario NAME --original-id HASH. report is keyless/read-only.\n" +
      "Crash exit codes 77/78/79 are intentional after native commits. Explicit resume owns stale local process lock recovery.\n" +
      "No replacement original, new nonce, auto retry, allowance renewal or automatic expiry resolution."); return;
  }
  let native: DatabaseSync | undefined, locked = false;
  try {
    if (!["initialize", "admit", "start", "resume", "resolve-expired", "reconcile", "report"].includes(action)) fail();
    const { values } = parseArgs({ args, strict: true, options: { "state-directory": { type: "string" }, policy: { type: "string" },
      "policy-sha256": { type: "string" }, "custody-env": { type: "string" }, scenario: { type: "string" },
      "original-id": { type: "string" }, "expected-sponsor-nonce": { type: "string" } } });
    const directory = values["state-directory"]!; assertFundedPrivatePath(directory, true);
    const file = join(directory, "funded-registration.sqlite");
    if (action === "initialize") {
      if (!values.policy || !values["policy-sha256"] || !values["custody-env"] || values.scenario || values["original-id"] || values["expected-sponsor-nonce"]) fail();
      readFundedCustody(values["custody-env"]); assertFundedPrivatePath(values.policy, false);
      const bytes = fs.readFileSync(values.policy); if (sha256(bytes) !== values["policy-sha256"]) fail();
      const manifest = fundedFixturePolicySchema.parse(JSON.parse(bytes.toString("utf8")));
      if (manifest.policy.expiresAt <= Date.now() || manifest.policy.expiresAt > Date.now() + 24 * 3600_000) fail();
      const binding = captureFundedSourceBinding(); if (binding.headCommit !== manifest.sourceCommit) fail();
      const fd = fs.openSync(file, "wx", 0o600); fs.closeSync(fd); assertFundedPrivatePath(file, false);
      native = new DatabaseSync(file); native.exec("PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=1000");
      initializeFundedFixture(native, manifest, binding); console.log(JSON.stringify({ status: "initialized", network: "eip155:5042002", policyDigest: registrationPolicyDigest(manifest.policy),
        sourcePin: verifyFundedSourceBinding(binding), sponsor: TESTNET_SPONSOR, creator: TESTNET_CREATOR })); return;
    }
    if (values.policy || values["policy-sha256"]) fail(); assertFundedPrivatePath(file, false);
    native = new DatabaseSync(file, { readOnly: action === "report" });
    if (action !== "report") native.exec("PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000");
    const retained = JSON.parse(String(native.prepare("SELECT value FROM fixture_manifest WHERE singleton=1").get()?.value));
    const manifest = fundedFixturePolicySchema.parse(retained.configuration), sourcePin = verifyFundedSourceBinding(retained.sourceBinding);
    if (sourcePin.declaredCommit !== manifest.sourceCommit) fail();
    selectRuntime(manifest);
    const db = await storageFacade(native);
    if (action === "report") {
      if (values.scenario || values["original-id"] || values["expected-sponsor-nonce"] || values["custody-env"]) fail();
      const originals = await Promise.all(FUNDED_SCENARIOS.map(scenario => db.getRegistrationSponsor!({ wallet: TESTNET_CREATOR, canonicalUrl: fundedCanonicalUrl(manifest, scenario) })));
      const rows = originals.filter((row): row is SponsoredRegistration => !!row), actual = rows.reduce((total, row) => total + BigInt(row.actualGasWei ?? "0"), BigInt(0));
      console.log(JSON.stringify({ network: "eip155:5042002", claimEvidence: manifest.claimEvidence, policyDigest: registrationPolicyDigest(manifest.policy), sourcePin,
        registry: manifest.policy.registryAddress, creator: TESTNET_CREATOR, sponsor: TESTNET_SPONSOR, admitted: rows.length,
        maxLifetimeWei: manifest.policy.maxLifetimeWei, actualGasWei: actual.toString(),
        originals: rows.map(row => ({ id: row.id, scenario: FUNDED_SCENARIOS.find(scenario => fundedCanonicalUrl(manifest, scenario) === row.canonicalUrl),
          state: row.state, creatorNonce: row.nonce, sponsorNonce: row.transactionNonce, transactionHash: row.transactionHash, reservedWei: row.reservedWei,
          actualGasWei: row.actualGasWei, expiredResolution: row.expiredResolution, creatorSignatureOrRawIncluded: false })),
        events: native.prepare("SELECT scenario,phase,value FROM fixture_events ORDER BY sequence").all().map(row => ({ scenario: row.scenario, phase: row.phase, evidence: JSON.parse(String(row.value)) })),
        productionActivated: false, publisherControlAccepted: false })); return;
    }
    const scenario = scenarioSchema.parse(values.scenario);
    if ((action === "admit" || action === "reconcile") && (values["custody-env"] || values["expected-sponsor-nonce"]) || action === "admit" && values["original-id"]) fail();
    const custody = ["start", "resume", "resolve-expired"].includes(action) ? readFundedCustody(values["custody-env"]!) : undefined;
    const expectedNonce = custody ? z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(values["expected-sponsor-nonce"]) : undefined;
    acquireFundedFixtureLock(native, scenario, ["resume", "resolve-expired", "reconcile"].includes(action));
    locked = true;
    const chain = await fixtureChain(manifest, db, native, scenario, action, expectedNonce, custody);
    const ctx: RegistrationSponsorContext = { db, chain, policy: manifest.policy, assertPolicy() { if (Date.now() >= manifest.policy.expiresAt) fail(); } };
    await chain.assertRegistry();
    let original = await db.getRegistrationSponsor!({ wallet: TESTNET_CREATOR, canonicalUrl: fundedCanonicalUrl(manifest, scenario) });
    if (action === "admit") {
      if (!original) {
        original = fundedFixtureOriginal(manifest, scenario, await chain.registrationNonce(TESTNET_CREATOR), Date.now());
        const claim = fundedFixtureClaim(original, Date.now());
        native.prepare("INSERT INTO sync_state VALUES(?,?,?)").run("keryx:source-claims:v1:claim:" + claim.id, canonicalJson(claim), new Date().toISOString());
        original = await db.admitRegistrationSponsor!(manifest.policy, original);
      }
      console.log(JSON.stringify({ operation: "admitted-not-signed", scenario, original, sourcePin, policyDigest: registrationPolicyDigest(manifest.policy), expectedSponsorNonce: await chain.transactionNonce(), fixturePublisher: true })); return;
    }
    if (!original || original.id !== hash.parse(values["original-id"]) || expectedNonce !== undefined && original.transactionNonce !== undefined && original.transactionNonce !== expectedNonce) fail();
    const service = await import("../lib/sources/registration-sponsor-service");
    if (action === "start") {
      if (original.state !== "prepared" || !custody) fail();
      const signature = await custody.creator.signTypedData(registrationTypedData(original));
      original = await service.submitSponsoredRegistration(ctx, TESTNET_CREATOR, original.id, signature);
    } else if (action === "resume") original = await service.resumeSponsoredRegistration(ctx, TESTNET_CREATOR, original.id);
    else if (action === "resolve-expired") {
      if (scenario !== "expired-original") fail(); original = await service.resolveExpiredSponsoredRegistration(ctx, TESTNET_CREATOR, original.id);
    } else original = (await service.recoverSponsoredRegistration(db, TESTNET_CREATOR, original.id, chain))!;
    if (["confirmed", "reverted"].includes(original.state)) {
      const receipt = await chain.receipt(original.transactionHash!); if (!receipt) fail(); await observedReceipt(manifest, native, original, receipt);
    }
    console.log(JSON.stringify({ operation: action, scenario, original, sourcePin, fixturePublisher: true, productionActivated: false }));
  } catch { console.error("Funded testnet acceptance unavailable or refused; preserve private originals; no automatic retry."); process.exitCode = 2; }
  finally { if (native) { if (locked) native.prepare("DELETE FROM fixture_lock WHERE pid=? AND host=?").run(process.pid, hostname()); native.close(); } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
