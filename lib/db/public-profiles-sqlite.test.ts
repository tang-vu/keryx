import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { writeSqliteQueryRun } from "./query-run-record";
import { createSqlitePrivateProfiles } from "./private-profiles-sqlite";
import { createSqliteProfileIdentities } from "./profile-identities-sqlite";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "./run-privacy-sqlite";
import { createSqliteRunClaims, RUN_CLAIMS_SQL } from "./run-claims-sqlite";
import { createSqliteRunOwnershipHistory } from "./run-ownership-history-sqlite";
import { createSqlitePublicProfiles } from "./public-profiles-sqlite";
import type { QueryRun } from "../types";
import type { PublicProfileActor, PublicProfileInput } from "../profiles/public-profile";

const connections: DatabaseSync[] = [];
afterEach(() => connections.splice(0).forEach(db => db.close()));
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const binding = { network: "eip155:5042002" as const, origin: "https://profile-fixture.example" };
const actor: PublicProfileActor = { wallet: alice, sessionHash: hash(alice), binding };
const input = (runIds: string[] = [], fields: PublicProfileInput["fields"] = ["displayName"], revision = 0): PublicProfileInput => ({ published: true, runIds, fields, revision });

async function fixture() {
  const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db);
  db.exec(RUN_CLAIMS_SQL);
  const profiles = createSqlitePrivateProfiles(db), identities = createSqliteProfileIdentities(db), now = Date.now();
  for (const [wallet, handle] of [[alice, "alice"], [bob, "bobby"]]) {
    await profiles.update(wallet, { handle, displayName: handle, bio: "PRIVATE bio", purpose: "PRIVATE purpose", links: [{ kind: "website", url: "https://www.example.org/unverified" }] });
    db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(hash(wallet), wallet, now - 1000, now + 600000);
  }
  const save = (id: string, owner: string | null = alice, extra: Partial<QueryRun> = {}) => {
    const run: QueryRun = { id, question: `Question ${id}`, createdAt: new Date(now - 100).toISOString(), answer: "PRIVATE answer", subClaims: ["PRIVATE claim"],
      citations: [], decisions: [], trace: [], engine: "heuristic", budget: 1, totalSpent: 0, totalToCreators: 0, ...(owner ? { asker: owner } : {}), ...extra };
    writeSqliteQueryRun(db, run, true); return run;
  };
  save("historical"); // Missing historical sidecar must never become PUBLIC through publication.
  db.exec(RUN_PRIVACY_SQL);
  const history = createSqliteRunOwnershipHistory(db), privacy = createSqliteRunPrivacy(db, history);
  const publicProfiles = createSqlitePublicProfiles(db, privacy, identities, history);
  const change = (id: string, visibility: "public" | "unlisted" | "private", revision = 0, wallet = alice) =>
    privacy.change(id, { ...actor, wallet, sessionHash: hash(wallet) }, { visibility, revision, requestId: randomUUID() });
  return { db, profiles, identities, save, history, privacy, publicProfiles, change };
}

describe("#264 ordinary SQLite explicit publication", () => {
  it("is invisible until publication, publishes only selected fields, and excludes all non-PUBLIC runs", async () => {
    const f = await fixture(); f.save("public"); f.save("private"); f.save("unlisted"); f.save("foreign", bob); f.save("anonymous", null);
    await f.change("public", "public"); await f.change("unlisted", "unlisted"); await f.change("foreign", "public", 0, bob);
    expect(await f.publicProfiles.read("alice")).toBeNull(); expect(await f.publicProfiles.read("unknown_handle")).toBeNull(); expect(await f.publicProfiles.sitemap(1000)).toEqual([]);
    const original = f.db.prepare("SELECT * FROM query_runs ORDER BY id").all(), privacy = f.db.prepare("SELECT * FROM run_privacy ORDER BY run_id").all();
    await f.publicProfiles.update(actor, input(["public", "private", "unlisted", "historical"]));
    const result = (await f.publicProfiles.read("alice"))!;
    expect(result.displayName).toBe("alice"); expect(result.about).toBeUndefined(); expect(result.purpose).toBeUndefined(); expect(result.verifiedLinks).toBeUndefined(); expect(result.ledgers).toBeUndefined();
    expect(result.runs.map(run => run.id)).toEqual(["public"]); expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(JSON.stringify(result)).not.toContain(alice);
    expect(f.db.prepare("SELECT * FROM query_runs ORDER BY id").all()).toEqual(original); expect(f.db.prepare("SELECT * FROM run_privacy ORDER BY run_id").all()).toEqual(privacy);
    expect((await f.publicProfiles.sitemap(1000)).map(row => row.handle)).toEqual(["alice"]);
  });
  it("requires authoritative ownership, not a public run, payer, guessed handle or API-key body", async () => {
    const f = await fixture(); f.save("foreign", bob); f.save("anonymous", null); await f.change("foreign", "public", 0, bob);
    for (const id of ["foreign", "anonymous", "absent"]) await expect(f.publicProfiles.update(actor, input([id]))).rejects.toMatchObject({ code: "not_owned" });
    expect(await f.publicProfiles.read("alice")).toBeNull();
    await f.profiles.update(alice, { displayName: "Alice", handle: "", bio: "", purpose: "", links: [] });
    await expect(f.publicProfiles.update(actor, input())).rejects.toMatchObject({ code: "profile_required" });
  });
  it("uses existing immutable receipt claims without exposing tokens or assigning a payer", async () => {
    const f = await fixture(), run = f.save("claimed", null), claims = createSqliteRunClaims(f.db);
    await claims.issue({ runId: run.id, completedAt: run.createdAt, binding, tokenHash: hash("synthetic-token") });
    await claims.claim({ tokenHash: hash("synthetic-token"), ...actor }); await f.change(run.id, "public");
    const before = f.db.prepare("SELECT * FROM anonymous_run_claims").all();
    await f.publicProfiles.update(actor, input([run.id])); const result = (await f.publicProfiles.read("alice"))!;
    expect(result.runs[0].ownership).toBe("claimed"); expect(result.runs[0].funding).toBe("unknown"); expect(JSON.stringify(result)).not.toContain(hash("synthetic-token"));
    expect(f.db.prepare("SELECT * FROM anonymous_run_claims").all()).toEqual(before);
  });
  it("unpublishes immediately in reads and sitemap; stale publication writes cannot resurrect it", async () => {
    const f = await fixture(); f.save("owned"); await f.change("owned", "public"); await f.publicProfiles.update(actor, input(["owned"]));
    await f.publicProfiles.unpublish(actor); expect(await f.publicProfiles.read("alice")).toBeNull(); expect(await f.publicProfiles.sitemap(1000)).toEqual([]);
    await expect(f.publicProfiles.update(actor, input(["owned"], ["displayName"], 1))).rejects.toMatchObject({ code: "conflict" });
    await f.publicProfiles.update(actor, input(["owned"], ["displayName"], 2)); await f.change("owned", "private", 1);
    expect((await f.publicProfiles.read("alice"))?.runs).toEqual([]);
    await f.privacy.erase("owned", actor, { revision: 2, requestId: randomUUID() }); expect((await f.publicProfiles.read("alice"))?.runs).toEqual([]);
  });
  it("rechecks unpublish and visibility after asynchronous identity I/O", async () => {
    const f = await fixture(); f.save("owned"); await f.change("owned", "public"); await f.publicProfiles.update(actor, input(["owned"], ["verifiedLinks"]));
    const port = createSqlitePublicProfiles(f.db, f.privacy, { ...f.identities, async list(wallet) { await f.publicProfiles.unpublish(actor); return f.identities.list(wallet); } }, f.history);
    expect(await port.read("alice")).toBeNull();
    await f.publicProfiles.update(actor, input(["owned"], ["verifiedLinks"], 2));
    const changed = createSqlitePublicProfiles(f.db, f.privacy, { ...f.identities, async list(wallet) { await f.change("owned", "unlisted", 1); return f.identities.list(wallet); } }, f.history);
    expect((await changed.read("alice"))?.runs).toEqual([]);
  });
  it("does not publish after revocation while an ownership read is in flight", async () => {
    const f = await fixture(); f.save("owned");
    const port = createSqlitePublicProfiles(f.db, { ...f.privacy, async owner(id, who) { const result = await f.privacy.owner(id, who); f.db.prepare("DELETE FROM web_sessions WHERE wallet=?").run(alice); return result; } }, f.identities, f.history);
    await expect(port.update(actor, input(["owned"]))).rejects.toMatchObject({ code: "unauthenticated" }); expect(await f.publicProfiles.read("alice")).toBeNull();
  });
  it("hides both old and new handles after rename and cascades publication on profile deletion", async () => {
    const f = await fixture(); await f.publicProfiles.update(actor, input());
    await f.profiles.update(alice, { displayName: "Alice", handle: "renamed", bio: "", purpose: "", links: [] });
    expect(await f.publicProfiles.read("alice")).toBeNull(); expect(await f.publicProfiles.read("renamed")).toBeNull(); expect(await f.publicProfiles.sitemap(1000)).toEqual([]);
    await f.publicProfiles.update(actor, input([], ["displayName"], 1)); expect((await f.publicProfiles.read("renamed"))?.displayName).toBe("Alice");
    await f.profiles.delete(alice); expect(await f.publicProfiles.read("renamed")).toBeNull(); expect(f.db.prepare("SELECT count(*) n FROM public_researcher_profiles").get()?.n).toBe(0);
  });
  it("publishes verified identities only, removes unlinked links and survives port reconstruction", async () => {
    const f = await fixture(), challenge = { wallet: alice, sessionHash: actor.sessionHash, stateHash: hash("oauth-state"), provider: "github" as const, expiresAt: new Date(Date.now() + 60000).toISOString() };
    await f.identities.begin(challenge); await f.identities.consume(challenge); await f.identities.complete(challenge, { provider: "github", externalId: "123", label: "alice" });
    await f.publicProfiles.update(actor, input([], ["verifiedLinks"]));
    const rebuilt = createSqlitePublicProfiles(f.db, f.privacy, f.identities, f.history);
    expect((await rebuilt.read("alice"))?.verifiedLinks?.map(link => link.url)).toEqual(["https://github.com/alice"]);
    await f.identities.unlink(alice, "github"); expect((await rebuilt.read("alice"))?.verifiedLinks).toEqual([]); expect(JSON.stringify(await rebuilt.read("alice"))).not.toContain("www.example.org/unverified");
  });
  it("matches settled wallet ledgers exactly, excludes simulations/pending/fees and keeps treasury sponsorship separate", async () => {
    const f = await fixture(); f.save("reader", alice, { fundingOwner: "browser", paymentMode: "real" }); f.save("sponsored", alice, { fundingOwner: "treasury", paymentMode: "real" }); f.save("simulated", alice, { paymentMode: "offline" });
    const payment = (id: string, query: string, amount: number, options: { payer?: string; payee?: string; status?: string; settled?: number; kind?: string; tx?: string | null; network?: string } = {}) => f.db.prepare(`INSERT INTO payment_events
      (id,query_id,kind,payer,payee,amount_usdc,network,settled,settlement_status,tx_hash) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id, query, options.kind ?? "citation", options.payer ?? alice, options.payee ?? bob, amount, options.network ?? binding.network, options.settled ?? 1, options.status ?? "settled", options.tx === undefined ? "synthetic-confirmed-receipt" : options.tx);
    payment("micro", "reader", 0.000001); payment("six", "reader", 1000.000001); payment("earned", "reader", 0.123456, { payer: bob, payee: alice });
    payment("treasury", "sponsored", 0.5, { payer: bob }); payment("mainnet", "reader", 2, { network: "eip155:5042" });
    payment("pending", "reader", 99, { status: "pending", settled: 0 }); payment("simulation", "simulated", 99); payment("sim-status", "reader", 99, { status: "simulated" });
    payment("fee", "reader", 99, { kind: "operating-fee" }); payment("inbound", "reader", 99, { kind: "inbound" }); payment("proofless", "reader", 99, { tx: null });
    const before = f.db.prepare("SELECT * FROM payment_events ORDER BY id").all(); await f.publicProfiles.update(actor, input([], ["ledgers"]));
    const result = (await f.publicProfiles.read("alice"))!;
    expect(result.ledgers).toEqual([{ network: "eip155:5042", readerPaidMicros: "2000000", creatorEarnedMicros: "0", sponsoredCreatorPaymentsMicros: "0" },
      { network: binding.network, readerPaidMicros: "1000000002", creatorEarnedMicros: "123456", sponsoredCreatorPaymentsMicros: "500000" }]);
    expect(result.runs).toEqual([]); expect(JSON.stringify(result)).not.toContain('"reader"'); // No private run identifiers.
    expect(f.db.prepare("SELECT * FROM payment_events ORDER BY id").all()).toEqual(before);
    payment("invalid-precision", "reader", 0.0000001); expect((await f.publicProfiles.read("alice"))?.ledgers?.[1].readerPaidMicros).toBeNull();
  });
  it("refuses unknown publication triggers without repair and leaves privacy-disabled stores unmodified", async () => {
    const f = await fixture(); f.db.exec("CREATE TRIGGER unexpected_public_hook AFTER UPDATE ON public_researcher_profiles BEGIN SELECT 1; END;");
    const shape = f.db.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all(); await expect(f.publicProfiles.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(() => createSqlitePublicProfiles(f.db, f.privacy, f.identities)).toThrow("public_profile_unavailable"); expect(f.db.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all()).toEqual(shape);
    const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db);
    expect(() => createSqlitePublicProfiles(db, f.privacy, f.identities)).toThrow("public_profile_unavailable");
    expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='public_researcher_profiles'").get()).toBeUndefined();
    f.db.exec("CREATE TABLE keryx_storage_identity (marker TEXT);");
    await expect(f.publicProfiles.settings(actor)).rejects.toMatchObject({code:"public_profile_unavailable"});
  });
});
