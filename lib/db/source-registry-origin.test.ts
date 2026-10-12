import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { SqliteAdapter } from "./sqlite-adapter";
import type { Source } from "../types";
import type { SourceRegistryAuthority } from "../registry/source-registry-authority";
import { registryCollisionKey } from "../registry/registry-collisions";
const m = vi.hoisted(() => ({ origins: "" }));
vi.mock("../config", async original => {
  const actual = await original<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, networkId: "eip155:5042", get registryOrigins() { return m.origins; } } };
});

const id = `0x${"aa".repeat(32)}`, wallet = `0x${"11".repeat(20)}`;
const legacy: SourceRegistryAuthority = { network: "eip155:5042", address: `0x${"22".repeat(20)}`, version: 1, codeHash: keccak256("0x6000"), deployBlock: "10" };
const current: SourceRegistryAuthority = { ...legacy, address: `0x${"33".repeat(20)}`, version: 3, codeHash: keccak256("0x6001"), deployBlock: "20" };
const source: Source = { id: "original-slug", onchainId: id, name: "Original", description: "Legacy source", url: "https://publisher.example",
  walletAddress: wallet, fetchPrice: 0.005, tags: [], authors: [{ name: "Owner", walletAddress: wallet, splitWeight: 1 }], createdAt: "2026-10-12", verified: true };
beforeEach(() => {
  m.origins = JSON.stringify([legacy, current]);
  vi.stubEnv("KERYX_REGISTRY_ORIGINS", m.origins); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS", m.origins);
});
afterEach(() => vi.unstubAllEnvs());
it("atomically binds existing metadata and projects the original origin across all source readers", async () => {
  const db = new SqliteAdapter(":memory:");
  try {
    await db.init(); await db.upsertSource(source);
    await db.setSourceMeta(id, { name: source.name, description: source.description, url: source.url, registryAuthority: legacy });
    expect(await db.getSource(source.id)).toMatchObject({ ...source, registryAuthority: legacy });
    expect(await db.getSourceByOnchainId(id)).toMatchObject({ registryAuthority: legacy, walletAddress: wallet, fetchPrice: 0.005 });
    expect(await db.listSources()).toEqual([expect.objectContaining({ registryAuthority: legacy })]);
    expect(await db.listAllSources()).toEqual([expect.objectContaining({ registryAuthority: legacy })]);
    await expect(db.setSourceMeta(id, { name: "Foreign", description: "", url: source.url, registryAuthority: { ...legacy, codeHash: current.codeHash } })).rejects.toThrow("allowlist");
    await expect(db.setSourceMeta(id, { name: "Hijacked", description: "", url: "https://other.example", registryAuthority: current })).rejects.toThrow("another immutable registry origin");
    expect(await db.getSourceMeta(id)).toMatchObject({ name: "Original", url: source.url, registryAuthority: legacy });
    await expect(db.upsertSource({ ...source, registryAuthority: current, walletAddress: current.address, fetchPrice: 0.9 })).rejects.toThrow("another immutable registry origin");
    expect(await db.getSource(source.id)).toMatchObject({ registryAuthority: legacy, walletAddress: wallet, fetchPrice: 0.005 });
    await db.upsertSource({ ...source, description: "Retained metadata update" });
    expect(await db.getSource(source.id)).toMatchObject({ registryAuthority: legacy, description: "Retained metadata update" });
  } finally { db.close(); }
});
it("never changes a bound row's original on-chain ID or admits a partial conflicting binding", async () => {
  const db = new SqliteAdapter(":memory:");
  try {
    await db.init(); await db.upsertSource({ ...source, registryAuthority: legacy });
    const replacementId = `0x${"bb".repeat(32)}`;
    await expect(db.upsertSource({ ...source, onchainId: replacementId, registryAuthority: current })).rejects.toThrow("original bound on-chain identity");
    expect(await db.getSyncState("keryx:source-registry-origin:v1:" + replacementId)).toBeNull();
    expect(await db.getSource(source.id)).toMatchObject({ onchainId: id, registryAuthority: legacy });
    await db.setSyncState("keryx:source-registry-origin:v1:" + id, "{}");
    await expect(db.getSource(source.id)).rejects.toThrow();
  } finally { db.close(); }
});
it("retains the first collision atomically and refuses changing its source or origin", async () => {
  const db = new SqliteAdapter(":memory:");
  try {
    await db.init();
    const collision = { format: "keryx-registry-collision-v1", status: "withheld", onchainId: id, sourceId: source.id,
      observedOrigin: current, retainedOrigin: legacy, eventName: "SourceRegistered", transactionHash: `0x${"cc".repeat(32)}`, blockNumber: "40" };
    const key = registryCollisionKey(current, id);
    await db.setSyncState(key, JSON.stringify(collision));
    await db.setSyncState(key, JSON.stringify({ ...collision, eventName: "SourceUpdated", blockNumber: "41" }));
    expect(JSON.parse((await db.getSyncState(key))!)).toEqual(collision);
    await expect(db.setSyncState(key, JSON.stringify({ ...collision, sourceId: "different" }))).rejects.toThrow("original changed");
    expect(JSON.parse((await db.getSyncState(key))!)).toEqual(collision);
  } finally { db.close(); }
});
