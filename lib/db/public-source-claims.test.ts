import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { issueSqliteSourceClaimChallenge, verifySqliteSourceClaim, getSqliteSourceClaim, getSqliteSourceClaimForSource,
  bindSqliteSourceClaim, updateSqliteSourceClaimPolicy, reserveSqliteSourceClaimVerification } from "./public-source-claims";
import { canonicalSourceUrl } from "../sources/public-source-claim";
import { SqliteAdapter } from "./sqlite-adapter";

const wallet = "0x1111111111111111111111111111111111111111", other = "0x2222222222222222222222222222222222222222";
const input = { wallet, canonicalUrl: "https://publisher.example/Case", rssUrl: "https://publisher.example/rss",
  deploymentOrigin: "https://keryx.cc", network: "eip155:5042002", now: 1_000_000 };
const proofDigest = "b".repeat(64), onchainId = `0x${"c".repeat(64)}`;
const registryAddress = "0x8888888888888888888888888888888888888888";
function setup(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)");
  return db;
}
function verified(db: DatabaseSync) {
  const challenge = issueSqliteSourceClaimChallenge(db, input);
  return verifySqliteSourceClaim(db, { challengeId: challenge.id, wallet, proofDigest, now: input.now + 1 });
}

describe("retained atomic public source claims", () => {
  it("preserves case-sensitive paths and query identity; fragments never become ownership identity", () => {
    expect(canonicalSourceUrl("https://PUBLISHER.example/Case?a=1#fragment")).toBe("https://publisher.example/Case?a=1");
    expect(canonicalSourceUrl("https://publisher.example/case")).not.toBe(canonicalSourceUrl("https://publisher.example/Case"));
    expect(() => canonicalSourceUrl("http://publisher.example")).toThrow("HTTPS");
    expect(() => canonicalSourceUrl("https://user:pass@publisher.example")).toThrow("credential");
  });
  it("starts verified ownership free and atomically consumes proof only once", () => {
    const db = setup();
    try {
      const challenge = issueSqliteSourceClaimChallenge(db, input);
      expect(() => verifySqliteSourceClaim(db, { challengeId: challenge.id, wallet: other, proofDigest, now: input.now + 1 })).toThrow("wallet");
      const claim = verifySqliteSourceClaim(db, { challengeId: challenge.id, wallet, proofDigest, now: input.now + 1 });
      expect(claim).toMatchObject({ mode: "free", revision: 1, ownerWallet: wallet, distributionPermission: false });
      expect(() => verifySqliteSourceClaim(db, { challengeId: challenge.id, wallet, proofDigest, now: input.now + 2 })).toThrow("already used");
      expect(() => issueSqliteSourceClaimChallenge(db, { ...input, wallet: other })).toThrow("verified owner");
    } finally { db.close(); }
  });
  it("fails closed on expired originals and cross-origin feed proofs", () => {
    const db = setup();
    try {
      const challenge = issueSqliteSourceClaimChallenge(db, input);
      expect(() => verifySqliteSourceClaim(db, { challengeId: challenge.id, wallet, proofDigest,
        now: Date.parse(challenge.expiresAt) })).toThrow("expired");
      expect(getSqliteSourceClaim(db, challenge.claimId)).toBeNull();
      expect(() => issueSqliteSourceClaimChallenge(db, { ...input, rssUrl: "https://attacker.example/rss" })).toThrow("share an HTTPS origin");
      expect(() => issueSqliteSourceClaimChallenge(db, { ...input, proofMethod: "rss-channel" })).toThrow("exact feed URL");
      expect(issueSqliteSourceClaimChallenge(db, { ...input, publicReferenceId: "public:publisher", proofMethod: "rss-channel" }).proofMethod).toBe("rss-channel");
    } finally { db.close(); }
  });
  it("consumes durable prefetch allowances, including failed proof attempts", () => {
    const db = setup();
    try {
      const challenge = issueSqliteSourceClaimChallenge(db, input);
      for (let index = 0; index < 10; index++) reserveSqliteSourceClaimVerification(db, challenge.id, wallet, input.now + index);
      expect(() => reserveSqliteSourceClaimVerification(db, challenge.id, wallet, input.now + 11)).toThrow("limit");
      for (let index = 1; index < 5; index++) issueSqliteSourceClaimChallenge(db, input);
      expect(() => issueSqliteSourceClaimChallenge(db, input)).toThrow("limit");
    } finally { db.close(); }
  });
  it("binds exactly one owned identity free, rejects stale policy writes and orphan bindings", () => {
    const db = setup();
    try {
      const claim = verified(db), linked = bindSqliteSourceClaim(db, { claimId: claim.id, wallet,
        expectedRevision: claim.revision, sourceId: "owned", onchainId, registryAddress, now: input.now + 2 });
      expect(linked).toMatchObject({ mode: "free", revision: 2, linkedSourceId: "owned" });
      expect(() => updateSqliteSourceClaimPolicy(db, { claimId: claim.id, wallet, expectedRevision: claim.revision,
        mode: "citation-only", distributionPermission: true, now: input.now + 3 })).toThrow("changed");
      expect(() => bindSqliteSourceClaim(db, { claimId: claim.id, wallet, expectedRevision: linked.revision,
        sourceId: "public:publisher", onchainId, registryAddress })).toThrow("permanently free");
      const paid = updateSqliteSourceClaimPolicy(db, { claimId: claim.id, wallet, expectedRevision: linked.revision,
        mode: "citation-only", distributionPermission: true, now: input.now + 3 });
      expect(paid).toMatchObject({ revision: 3, mode: "citation-only", effectiveAt: new Date(input.now + 3).toISOString() });
      expect(getSqliteSourceClaimForSource(db, "owned")).toEqual(paid);
      expect(db.prepare("SELECT COUNT(*) AS n FROM sync_state WHERE key LIKE '%history:%'").get()?.n).toBe(3);
      db.prepare("DELETE FROM sync_state WHERE key LIKE '%claim:%'").run();
      expect(() => getSqliteSourceClaimForSource(db, "owned")).toThrow("Orphaned");
    } finally { db.close(); }
  });
  it("requires fresh proof and distinct consent; disabling remains possible after proof expiry", () => {
    const db = setup();
    try {
      const claim = verified(db), linked = bindSqliteSourceClaim(db, { claimId: claim.id, wallet, expectedRevision: 1,
        sourceId: "owned", onchainId, registryAddress, now: input.now + 2 });
      const change = { claimId: claim.id, wallet, expectedRevision: linked.revision, mode: "paid" as const, now: input.now + 3 };
      expect(() => updateSqliteSourceClaimPolicy(db, { ...change, distributionPermission: false })).toThrow("explicitly confirm");
      expect(() => updateSqliteSourceClaimPolicy(db, { ...change, distributionPermission: true,
        now: input.now + 24 * 3600_000 + 2 })).toThrow("Refresh");
      const free = updateSqliteSourceClaimPolicy(db, { ...change, mode: "free", distributionPermission: false,
        now: input.now + 24 * 3600_000 + 2 });
      expect(free.mode).toBe("free");
    } finally { db.close(); }
  });
  it("serializes competing native processes without awarding one URL to both wallets", async () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-claims-race-")), file = join(directory, "claims.sqlite"), db = setup(file);
    const a = issueSqliteSourceClaimChallenge(db, input), b = issueSqliteSourceClaimChallenge(db, { ...input, wallet: other }); db.close();
    const moduleUrl = new URL("./public-source-claims.ts", import.meta.url).href;
    const run = (challengeId: string, owner: string) => promisify(execFile)(process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", `import {DatabaseSync} from 'node:sqlite';
        import {verifySqliteSourceClaim} from ${JSON.stringify(moduleUrl)};
        const db=new DatabaseSync(${JSON.stringify(file)}); db.exec('PRAGMA busy_timeout=5000');
        try { verifySqliteSourceClaim(db,{challengeId:${JSON.stringify(challengeId)},wallet:${JSON.stringify(owner)},proofDigest:${JSON.stringify(proofDigest)},now:${input.now + 5}});console.log('won'); }
        catch { console.log('refused'); } finally { db.close(); }`]);
    try {
      const results = await Promise.all([run(a.id, wallet), run(b.id, other)]);
      expect(results.map(value => value.stdout.trim()).sort()).toEqual(["refused", "won"]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("exports sticky managed-source markers and rejects imports missing original claim history", async () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-claims-adapter-"));
    const db = new SqliteAdapter(join(directory, "one.sqlite")), copy = new SqliteAdapter(join(directory, "two.sqlite"));
    try {
      await db.init(); await copy.init();
      const challenge = await db.issueSourceClaimChallenge(input);
      const claim = await db.verifySourceClaim({ challengeId: challenge.id, wallet, proofDigest, now: input.now + 1 });
      await db.bindSourceClaim({ claimId: claim.id, wallet, expectedRevision: 1, sourceId: "owned", onchainId, registryAddress });
      await db.upsertSource({ id: "owned", name: "Publisher", url: input.canonicalUrl, rssUrl: input.rssUrl,
        description: "Actual owner feed", walletAddress: wallet, fetchPrice: 0, authors: [], tags: [], onchainId,
        createdAt: new Date().toISOString(), verified: true });
      const retained = await db.getSource("owned");
      expect(retained?.sourceClaimId).toBe(claim.id);
      expect((await db.listSources())[0]?.sourceClaimId).toBe(claim.id);
      await expect(copy.upsertSource(retained!)).rejects.toThrow("original source claim history");
    } finally { db.close(); copy.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it("contains corrupt managed authority per source while retaining its catalog marker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-claims-corruption-")), file = join(directory, "ledger.sqlite");
    const db = new SqliteAdapter(file);
    try {
      await db.init();
      const challenge = await db.issueSourceClaimChallenge(input);
      const claim = await db.verifySourceClaim({ challengeId: challenge.id, wallet, proofDigest, now: input.now + 1 });
      await db.bindSourceClaim({ claimId: claim.id, wallet, expectedRevision: 1, sourceId: "owned", onchainId, registryAddress });
      const source = { name: "Publisher", url: input.canonicalUrl, rssUrl: input.rssUrl, description: "Actual owner feed",
        walletAddress: wallet, fetchPrice: 0, authors: [], tags: [], onchainId, createdAt: new Date().toISOString(), verified: true };
      await db.upsertSource({ ...source, id: "owned" }); await db.upsertSource({ ...source, id: "unrelated" });
      const raw = new DatabaseSync(file);
      try {
        raw.prepare("DELETE FROM sync_state WHERE key LIKE '%history:%'").run();
        expect((await db.listSources()).map(value => [value.id, value.sourceClaimId])).toEqual([["owned", claim.id], ["unrelated", undefined]]);
        await expect(db.getSourceClaimForSource("owned")).rejects.toThrow();
        raw.prepare("UPDATE sync_state SET value=? WHERE key LIKE '%:source:%'").run("{corrupt");
        const catalog = await db.listSources();
        expect(catalog.find(value => value.id === "owned")?.sourceClaimId).toMatch(/^[a-f0-9]{64}$/);
        expect(catalog.find(value => value.id === "unrelated")?.sourceClaimId).toBeUndefined();
        await expect(db.getSourceClaimForSource("owned")).rejects.toThrow();
        raw.prepare("UPDATE sync_state SET value=? WHERE key LIKE '%:source:%'").run("null");
        expect((await db.getSource("owned"))?.sourceClaimId).toMatch(/^[a-f0-9]{64}$/);
        await expect(db.getSourceClaimForSource("owned")).rejects.toThrow();
      } finally { raw.close(); }
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
