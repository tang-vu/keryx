/** Isolated native HTTPS/PG fixture child. Configuration is supplied only by the
 * owning evaluator; this script never loads application environment files. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { QueryRun, Source } from "../../lib/types";

const requireFixture = createRequire(import.meta.url);
const { StorageIdentityRefused } = requireFixture("../../lib/db/storage-identity.ts") as typeof import("../../lib/db/storage-identity");
const {
  createEnrolledSupabaseAdapter, createReadonlyEnrolledSupabaseAdapter,
  assertEnrolledSupabaseAuthority, closeEnrolledSupabaseAdapter,
} = requireFixture("../../lib/db/enrolled-supabase-adapter.ts") as typeof import("../../lib/db/enrolled-supabase-adapter");
const mode = process.argv[2];
assert(["refused-startup", "read-write", "auth-user", "query-metrics", "readonly", "drift", "domains", "domain-binding", "domain-capacity", "domain-terminal", "domain-auth", "domain-treasury", "quota"].includes(mode));
const stage = (name: string) => process.stdout.write(`STAGE ${name}\n`);
stage("startup");

try {
  if (mode === "refused-startup") {
    await assert.rejects(createEnrolledSupabaseAdapter());
    process.stdout.write("PASS closed factory startup refusal\n");
  } else {
    const db = mode === "readonly"
      ? await createReadonlyEnrolledSupabaseAdapter()
      : await createEnrolledSupabaseAdapter();
    try {
      stage("provenance");
      const deployment = await assertEnrolledSupabaseAuthority(db);
      assert.equal(deployment.backend.kind, "supabase");
      assert.equal(Object.getPrototypeOf(db), null);
      assert.deepEqual(Object.keys(db), []);
      assert.throws(() => Reflect.get(db, "sb"));
      await assert.rejects(assertEnrolledSupabaseAuthority({ ...db }));
      await assert.rejects(assertEnrolledSupabaseAuthority(db, "invalid" as "read"));

      if (mode === "quota") {
        stage("quota");
        const body = "x".repeat(1024 * 1024);
        // enc:v3 wraps base64 ciphertext in a second base64 JSON envelope:
        // four full rows fit (~7.46MiB), while five exceed the 8MiB quota.
        for (let i = 0; i < 3; i++) await db.setCached(`quota-seed-${i}`, body);
        const results = await Promise.allSettled([db.setCached("quota-race-a", body), db.setCached("quota-race-b", body)]);
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
        assert.equal(results.filter(result => result.status === "rejected").length, 1);
        const winner = results[0].status === "fulfilled" ? "quota-race-a" : "quota-race-b";
        const refused = winner === "quota-race-a" ? "quota-race-b" : "quota-race-a";
        assert.equal(await db.getCached(winner), body);
        assert.equal(await db.getCached(refused), null);
        await db.setCached(winner, "replacement releases wire quota only");
        await db.setCached(refused, body);
        assert.equal(await db.getCached(refused), body);
      } else if (mode === "domain-auth" || mode === "domain-treasury") {
        stage("domains");
        const { exerciseEnrolledSupabaseNativeAuth, exerciseEnrolledSupabaseNativeTreasury } = await import("./enrolled-supabase-native-domains.mts");
        await (mode === "domain-auth" ? exerciseEnrolledSupabaseNativeAuth : exerciseEnrolledSupabaseNativeTreasury)(db, deployment.identity);
      } else if (["domains", "domain-binding", "domain-capacity", "domain-terminal"].includes(mode)) {
        stage("domains");
        const { exerciseEnrolledSupabaseNativeDomains } = await import("./enrolled-supabase-native-domains.mts");
        const creator = process.env.KERYX_NATIVE_CREATOR;
        const payout = process.env.KERYX_NATIVE_PAYOUT;
        assert.match(creator ?? "", /^0x[0-9a-fA-F]{40}$/);
        assert.match(payout ?? "", /^0x[0-9a-fA-F]{40}$/);
        await exerciseEnrolledSupabaseNativeDomains(db, deployment.identity, {
          creator: creator as `0x${string}`, payout: payout as `0x${string}`,
        }, mode === "domain-binding" ? "binding" : mode === "domain-capacity" ? "capacity" : mode === "domain-terminal" ? "terminal" : "header");
      } else if (mode === "readonly") {
        stage("readonly");
        await db.listSources();
        await db.listPublicReferences!(); // Computed/stub entries still verify SQL authority.
        await assert.rejects(db.setCached("fixture-source", "must not write"));
        await assert.rejects(db.verifyApiKey("fixture", "0".repeat(64)));
        await assert.rejects(assertEnrolledSupabaseAuthority(db, "write"));
        for await (const run of db.iterateRecentQueries(2)) assert.equal(typeof run.id, "string");
      } else if (mode === "drift") {
        stage("drift");
        // The evaluator changes only its synthetic owner-controlled DB after this
        // handshake. Resume input carries no authority, identity or provider data.
        process.stdout.write("READY synthetic schema drift\n");
        await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
        await assert.rejects(db.listPublicReferences!());
        await assert.rejects(db.getPublicReference!("absent"));
        await assert.rejects(async () => {
          for await (const run of db.iterateRecentQueries(1)) void run;
        });
        await assert.rejects(assertEnrolledSupabaseAuthority(db));
      } else {
        await assertEnrolledSupabaseAuthority(db, "write");
        const source: Source = {
          id: "fixture-source", name: "Synthetic source", url: "https://fixture.invalid/source",
          description: "Native isolated backend test", walletAddress: "0x" + "1".repeat(40),
          fetchPrice: 0.01, tags: [], authors: [], createdAt: "2026-01-01T00:00:00.000Z",
          active: true, verified: true, previewDepth: "excerpt",
        };
        if (mode === "read-write") {
          stage("source-write");
          await db.upsertSource(source);
          assert.equal((await db.getSource(source.id))?.previewDepth, "excerpt");
          assert.equal((await db.listAllSources()).length, 1);
          stage("cache");
          await db.setCached(source.id, "private synthetic body");
          assert.equal(await db.getCached(source.id), "private synthetic body");
          await db.setCached(source.id, "replacement synthetic body");
          assert.equal(await db.getCached(source.id), "replacement synthetic body");
          stage("oversize-cache");
          await assert.rejects(db.setCached(source.id, "x".repeat(1024 * 1024 + 1)));
          assert.equal(await db.getCached(source.id), "replacement synthetic body");
        } else {
          if (mode === "auth-user") {
            const now = Date.now();
            stage("create-challenge");
            await db.createAuthChallenge("a".repeat(64), now, now + 60_000);
            stage("consume-challenge");
            assert.equal(await db.consumeAuthChallenge("a".repeat(64), now), true);
            stage("reconsume-challenge");
            assert.equal(await db.consumeAuthChallenge("a".repeat(64), now), false);
            stage("upsert-user");
            const user = await db.upsertUser(source.walletAddress, "creator");
            assert.equal(user.created, true);
            stage("read-user");
            assert.equal((await db.getUser(source.walletAddress))?.walletAddress, source.walletAddress);
          } else {
            stage("query");
            await db.setSyncState("fixture-sync", "first");
            assert.equal(await db.getSyncState("fixture-sync"), "first");
            await db.setSyncState("fixture-sync", "replacement");
            assert.equal(await db.getSyncState("fixture-sync"), "replacement");
            const run: QueryRun = {
              id: "fixture-query", question: "Synthetic?", budget: 0, engine: "fixture",
              subClaims: [], decisions: [], citations: [], answer: "Synthetic answer",
              totalSpent: 0, totalToCreators: 0, trace: [], createdAt: source.createdAt,
            };
            await db.saveQueryRun(run);
            assert.equal((await db.getQueryRun(run.id))?.answer, run.answer);
            const streamed: QueryRun[] = [];
            for await (const row of db.iterateRecentQueries(2)) streamed.push(row);
            assert.deepEqual(streamed.map((row) => row.id), [run.id]);
            stage("metrics");
            await db.metrics();
            stage("creator-leaderboard");
            await db.creatorLeaderboard();
          }
        }
      }
    } finally {
      stage("close");
      closeEnrolledSupabaseAdapter(db);
      await assert.rejects(assertEnrolledSupabaseAuthority(db));
      await assert.rejects(db.listPublicReferences!());
    }
    process.stdout.write(`PASS native closed factory ${mode}\n`);
  }
} catch (error) {
  const record = error as { name?: unknown; code?: unknown };
  const category = error instanceof assert.AssertionError ? "assertion"
    : record.name === "EnrolledSupabaseWriteOutcomeUnknown" ? "write-uncertain"
    : error instanceof StorageIdentityRefused ? "storage-refused"
    : error instanceof TypeError ? "type-error" : "operation-refused";
  const code = record.code === "ERR_ASSERTION" ? "ERR_ASSERTION"
    : typeof record.code === "string" && /^[0-9A-Z]{5}$/.test(record.code) ? record.code : "none";
  const reasons = new Set(["invalid_operation", "identity_unavailable", "identity_mismatch",
    "adapter_not_initialized", "readonly_operation", "cache_migration_required"]);
  const reason = error instanceof StorageIdentityRefused && reasons.has(error.reason) ? error.reason : "none";
  process.stderr.write(`FIXTURE_FAILURE category=${category} code=${code} reason=${reason}\n`);
  process.exitCode = 1;
}
