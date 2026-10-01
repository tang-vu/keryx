/** Isolated native HTTPS/PG fixture child. Configuration is supplied only by the
 * owning evaluator; this script never loads application environment files. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { QueryRun, Source } from "../../lib/types";

const requireFixture = createRequire(import.meta.url);
const {
  createEnrolledSupabaseAdapter, createReadonlyEnrolledSupabaseAdapter,
  assertEnrolledSupabaseAuthority, closeEnrolledSupabaseAdapter,
} = requireFixture("../../lib/db/supabase-adapter.ts") as typeof import("../../lib/db/supabase-adapter");
const mode = process.argv[2];
assert(["refused-startup", "read-write", "readonly", "drift"].includes(mode));

if (mode === "refused-startup") {
  await assert.rejects(createEnrolledSupabaseAdapter());
  process.stdout.write("PASS closed factory startup refusal\n");
} else {
  const db = mode === "readonly"
    ? await createReadonlyEnrolledSupabaseAdapter()
    : await createEnrolledSupabaseAdapter();
  try {
    const deployment = await assertEnrolledSupabaseAuthority(db);
    assert.equal(deployment.backend.kind, "supabase");
    assert.equal(Object.getPrototypeOf(db), null);
    assert.deepEqual(Object.keys(db), []);
    assert.throws(() => Reflect.get(db, "sb"));
    await assert.rejects(assertEnrolledSupabaseAuthority({ ...db }));
    await assert.rejects(assertEnrolledSupabaseAuthority(db, "invalid" as "read"));

    if (mode === "readonly") {
      await db.listSources();
      await db.listPublicReferences!(); // Computed/stub entries still verify SQL authority.
      await assert.rejects(db.setCached("fixture-source", "must not write"));
      await assert.rejects(db.verifyApiKey("fixture", "0".repeat(64)));
      await assert.rejects(assertEnrolledSupabaseAuthority(db, "write"));
      for await (const run of db.iterateRecentQueries(2)) assert.equal(typeof run.id, "string");
    } else if (mode === "drift") {
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
      await db.upsertSource(source);
      assert.equal((await db.getSource(source.id))?.previewDepth, "excerpt");
      assert.equal((await db.listAllSources()).length, 1);
      await db.setCached(source.id, "private synthetic body");
      assert.equal(await db.getCached(source.id), "private synthetic body");
      await db.setCached(source.id, "replacement synthetic body");
      assert.equal(await db.getCached(source.id), "replacement synthetic body");
      await assert.rejects(db.setCached(source.id, "x".repeat(1024 * 1024 + 1)));
      assert.equal(await db.getCached(source.id), "replacement synthetic body");
      const now = Date.now();
      await db.createAuthChallenge("a".repeat(64), now, now + 60_000);
      assert.equal(await db.consumeAuthChallenge("a".repeat(64), now), true);
      assert.equal(await db.consumeAuthChallenge("a".repeat(64), now), false);
      const user = await db.upsertUser(source.walletAddress, "creator");
      assert.equal(user.created, true);
      assert.equal((await db.getUser(source.walletAddress))?.walletAddress, source.walletAddress);
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
      await db.metrics();
      await db.creatorLeaderboard();
    }
  } finally {
    closeEnrolledSupabaseAdapter(db);
    await assert.rejects(assertEnrolledSupabaseAuthority(db));
    await assert.rejects(db.listPublicReferences!());
  }
  process.stdout.write(`PASS native closed factory ${mode}\n`);
}
