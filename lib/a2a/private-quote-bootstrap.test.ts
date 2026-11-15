import { afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { KeryxDB } from "../db/keryx-db";
const state = vi.hoisted(() => ({ config: { funderKey: "", networkId: "eip155:5042002", sellerAddress: `0x${"1".repeat(40)}`,
  privateResearchReservedPayees: `0x${"4".repeat(40)}` } }));
vi.mock("../config", () => state);
import { privateQuoteBootstrap } from "./private-quote-bootstrap";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("is off by default and derives configured signer identities without exposing payment operations", async () => {
  vi.stubEnv("KERYX_PRIVATE_RESEARCH_ENABLED", "0");
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No outbound HTTP"); }));
  const db = {} as KeryxDB;
  expect(await privateQuoteBootstrap(db)).toBeNull();
  // Ephemeral, unfunded keys; no persisted wallet or signing request.
  const privateKey = generatePrivateKey(); state.config.funderKey = generatePrivateKey();
  const env = { KERYX_PRIVATE_RESEARCH_ENABLED: "1", KERYX_PRIVATE_TREASURY_PRIVATE_KEY: privateKey,
    KERYX_PRIVATE_TREASURY_ADDRESS: privateKeyToAccount(privateKey).address, KERYX_PRIVATE_RESEARCH_PAYEE: state.config.privateResearchReservedPayees,
    KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: state.config.privateResearchReservedPayees, KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "50000",
    KERYX_PRIVATE_SERVICE_FEE_MICROS: "20000", KERYX_PRIVATE_MODEL_ID: "deepseek-flash", KERYX_PRIVATE_PROVIDER: "deepseek",
    KERYX_PRIVATE_PROVIDER_BASE_URL: "https://synthetic.example/v1", KERYX_PRIVATE_PROVIDER_API_KEY: "synthetic-secret",
    KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://synthetic.example/v1/chat/completions"]' };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const bootstrap = (await privateQuoteBootstrap(db))!;
  expect(Object.keys(bootstrap)).toEqual(["quote"]);
  const quote = bootstrap.quote({ question: "Synthetic quote question", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" });
  expect(quote.requirement.amount).toBe("50000");
  expect(JSON.stringify(quote)).not.toContain(privateKey);
  expect(JSON.stringify(quote)).not.toContain("synthetic-secret");
  vi.stubEnv("KERYX_PRIVATE_PROVIDER_API_KEY", "changed-credential");
  expect(() => bootstrap.quote({})).toThrow();
  vi.stubEnv("KERYX_PRIVATE_PROVIDER_API_KEY", "synthetic-secret");
  expect(fetch).not.toHaveBeenCalled();
  vi.stubEnv("KERYX_PRIVATE_TREASURY_PRIVATE_KEY", "synthetic-secret-invalid-key");
  await expect(privateQuoteBootstrap(db)).rejects.toThrow(/^Private quote configuration unavailable$/);
});

it("awaits both mainnet policies on a genuine synthetic enrolled SQLite source and rejects changes during the last policy await", async () => {
  vi.resetModules();
  const { mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"), { join } = await import("node:path"), { randomUUID } = await import("node:crypto");
  const folder = mkdtempSync(join(tmpdir(), "keryx-private-quote-async-"));
  let reader: { close(): void } | undefined;
  const saved = { ...state.config };
  try {
    for (const [key, value] of Object.entries({ KERYX_NETWORK: "arc", NEXT_PUBLIC_KERYX_NETWORK: "arc", KERYX_FORCE_OFFLINE: "0",
      CONTENT_MASTER_KEY: "ab".repeat(32), BASE_URL: "https://keryx.cc", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
      AGENT_FUNDER_PRIVATE_KEY: "", BUYER_PRIVATE_KEY: "", KERYX_MAINNET_TREASURY_PRIVATE_KEY: "", KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY: "",
      KERYX_PRIVATE_TREASURY_PRIVATE_KEY: "", KERYX_REGISTRY_ADDRESS: "0x" + "55".repeat(20), NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: "0x" + "55".repeat(20),
      KERYX_REGISTRY_READ_ADDRESS: "0x" + "55".repeat(20), NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS: "0x" + "55".repeat(20),
      KERYX_REGISTRY_ORIGINS: "", NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS: "" })) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("No external HTTP or funding"); }));
    const { ARC_MAINNET_PROFILE } = await import("../arc-network-profile");
    Object.assign(state.config, { profile: ARC_MAINNET_PROFILE, networkId: ARC_MAINNET_PROFILE.networkId, baseUrl: "https://keryx.cc", funderKey: "" });
    const { canonicalJson } = await import("../canonical-json"), storage = await import("../db/storage-identity");
    const identity = { format: "keryx-mainnet-storage-identity-v1" as const, authorityMode: "mainnet-real" as const,
      network: ARC_MAINNET_PROFILE.networkId, profileDigest: storage.STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(),
      enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
    const file = join(folder, "source.sqlite"), manifest = join(folder, "storage.json");
    await (await import("../db/storage-identity-provision")).createSqliteStorage(file, identity);
    writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
    vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file);
    const { hostedTreasuryPolicyDigest } = await import("../payments/hosted-treasury-policy");
    for (const [prefix, signer] of [["KERYX_MAINNET_TREASURY", "0x" + "33".repeat(20)], ["KERYX_MAINNET_PRIVATE_TREASURY", "0x" + "22".repeat(20)]]) {
      const policy = { format: "keryx-hosted-treasury-policy-v1" as const, network: ARC_MAINNET_PROFILE.networkId,
        storageIdentityDigest: storage.storageIdentityDigest(identity), origin: "https://keryx.cc", signer,
        lifetimeCapMicroUsdc: "100000", queryCapMicroUsdc: "50000", expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600 };
      vi.stubEnv(prefix + "_POLICY_JSON", canonicalJson(policy)); vi.stubEnv(prefix + "_POLICY_DIGEST", hostedTreasuryPolicyDigest(policy));
    }
    for (const [key, value] of Object.entries({ KERYX_PRIVATE_RESEARCH_ENABLED: "1", KERYX_PRIVATE_TREASURY_ADDRESS: "0x" + "22".repeat(20),
      KERYX_PRIVATE_RESEARCH_PAYEE: state.config.privateResearchReservedPayees, KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: state.config.privateResearchReservedPayees,
      KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "50000", KERYX_PRIVATE_SERVICE_FEE_MICROS: "20000", KERYX_PRIVATE_MODEL_ID: "deepseek-flash",
      KERYX_PRIVATE_PROVIDER: "deepseek", KERYX_PRIVATE_PROVIDER_BASE_URL: "https://synthetic.example/v1", KERYX_PRIVATE_PROVIDER_API_KEY: "synthetic-secret",
      KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://synthetic.example/v1/chat/completions"]' })) vi.stubEnv(key, value);
    const app = await import("../db/application-storage"), db = await app.createApplicationStorage(); expect(db).toBeDefined();
    reader = db as unknown as { close(): void };
    const bootstrap = (await import("./private-quote-bootstrap")).privateQuoteBootstrap;
    const service = await bootstrap(db!); expect(service).not.toBeNull();
    expect(service!.quote({ question: "Synthetic Source quote", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" }).requirement.amount).toBe("50000");
    const hosted = await import("../payments/mainnet-hosted-gateway"), original = hosted.mainnetHostedPolicy;
    let release!: () => void, entered!: () => void, resolved = false;
    const gate = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(hosted, "mainnetHostedPolicy").mockImplementation(async (selected, role) => {
      const policy = await original(selected, role); if (role === "private") { entered(); await gate; } return policy;
    });
    const pending = bootstrap(db!).then(value => { resolved = true; return value; }); await reached; expect(resolved).toBe(false);
    vi.stubEnv("KERYX_PRIVATE_PROVIDER_API_KEY", "changed-during-policy-await"); release();
    await expect(pending).rejects.toThrow("Private quote configuration unavailable"); expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks(); reader?.close();
    for (const key of Object.keys(state.config)) if (!(key in saved)) Reflect.deleteProperty(state.config, key);
    Object.assign(state.config, saved); for (const file of readdirSync(folder)) unlinkSync(join(folder, file)); rmdirSync(folder);
  }
}, 20000);
