import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { assertRunPrivacySchema, createEnrolledSqliteRunPrivacy } from "./run-privacy-sqlite";
import { PRIVATE_PROFILES_SQL } from "./private-profiles-sqlite";
import { privateProfileRecordSchema } from "../profiles/private-profile";
import { identitySnapshotSchema, identityUrl, type ProfileIdentitiesStore } from "../profiles/verified-identities";
import type { RunPrivacyStore } from "../run-privacy/contracts";
import { validatePrivacyRun } from "../run-privacy/contracts";
import type { RunOwnershipHistoryStore } from "../run-claims/history";
import { PublicProfileError, publicHandle, publicProfileActor, publicProfileInput, publicProfileSettings,
  publicProfileSnapshot, type PublicProfilesStore, type PublicProfileActor, type PublicProfileSnapshot } from "../profiles/public-profile";
import { publicRun } from "../profiles/public-profile-projection";
import { installPublicProfileFunctions } from "./public-profile-functions";
import { createEnrolledSqliteProfileIdentities } from "./profile-identities-enrolled-sqlite";
import { createEnrolledSqliteRunOwnershipHistory } from "./run-ownership-history-sqlite";
import { canonicalJson } from "../canonical-json";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteWritePolicy, assertVerifiedSqliteForeignKeys,
  assertVerifiedSqliteNativeUserDomainPolicy } from "./storage-identity-connection";
import { assertStorageFences, STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";

/** Ordinary SOURCE-only publication metadata. No run visibility/default or financial row is changed. */
export const PUBLIC_PROFILES_SQL = `CREATE TABLE public_researcher_profiles (
  wallet TEXT PRIMARY KEY REFERENCES private_profiles(wallet) ON DELETE CASCADE,
  handle TEXT NOT NULL, published INTEGER NOT NULL CHECK(published IN (0,1)),
  fields TEXT NOT NULL CHECK(json_valid(fields) AND json_type(fields)='array' AND json_array_length(fields)<=5),
  run_ids TEXT NOT NULL CHECK(json_valid(run_ids) AND json_type(run_ids)='array' AND json_array_length(run_ids)<=50),
  binding TEXT NOT NULL CHECK(json_valid(binding)), revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 2147483647), updated_at TEXT NOT NULL
);`;
const shape = (db: DatabaseSync) => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name='public_researcher_profiles' ORDER BY type,name LIMIT 5").all();
let expected: string | undefined;
export function createSqlitePublicProfiles(db: DatabaseSync, privacy: RunPrivacyStore, identities: ProfileIdentitiesStore,
  history?: RunOwnershipHistoryStore): PublicProfilesStore {
  const authority = () => { try { assertOrdinarySqliteResearchAuthority(db); assertRunPrivacySchema(db); }
    catch { throw new PublicProfileError("public_profile_unavailable"); } };
  const guard = () => {
    authority();
    if (JSON.stringify(shape(db)) !== expected) throw new PublicProfileError("public_profile_unavailable");
  };
  authority();
  if (!expected) { const reference = new DatabaseSync(":memory:"); try { reference.exec(PRIVATE_PROFILES_SQL + PUBLIC_PROFILES_SQL); expected = JSON.stringify(shape(reference)); } finally { reference.close(); } }
  db.exec("BEGIN IMMEDIATE");
  try { if (shape(db).length && JSON.stringify(shape(db)) !== expected) throw new PublicProfileError("public_profile_unavailable");
    if (!shape(db).length) db.exec(PUBLIC_PROFILES_SQL); guard(); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
  installPublicProfileFunctions(db);
  return publicProfilesOperations(db, privacy, identities, history, guard).store;
}

type PublicProfileReadFinalizer = () => PublicProfileSnapshot | null;

/** Private factoring only: the ordinary constructor retains its authority, DDL,
 * aggregate registration and transaction body. Native hooks add no public escape. */
function publicProfilesOperations(db: DatabaseSync, privacy: RunPrivacyStore, identities: ProfileIdentitiesStore,
  history: RunOwnershipHistoryStore | undefined, guard: () => void, native?: {
    writeAccess(): void; afterAwait(): void; requireLedgers(): void;
    transaction<T>(operation: () => T): T;
  }): { store: PublicProfilesStore; prepareRead(handle: string): Promise<PublicProfileReadFinalizer> } {
  const profile = (wallet: string) => {
    const row = db.prepare("SELECT * FROM private_profiles WHERE wallet=?").get(wallet);
    return row ? privateProfileRecordSchema.parse({ wallet: row.wallet, handle: row.handle ?? "", displayName: row.display_name,
      bio: row.bio, purpose: row.purpose, links: JSON.parse(String(row.links)), createdAt: row.created_at, updatedAt: row.updated_at }) : null;
  };
  const settings = (wallet: string) => {
    const row = db.prepare("SELECT * FROM public_researcher_profiles WHERE wallet=?").get(wallet), current = profile(wallet);
    return publicProfileSettings.parse({ handle: current?.handle ?? "", published: !!row && row.published === 1 && row.handle === current?.handle,
      fields: row ? JSON.parse(String(row.fields)) : [], runIds: row ? JSON.parse(String(row.run_ids)) : [],
      revision: row?.revision ?? 0, updatedAt: row?.updated_at ?? null });
  };
  const actor = (input: PublicProfileActor) => {
    guard(); const who = publicProfileActor.parse(input), now = Date.now();
    if (!db.prepare("SELECT 1 FROM web_sessions WHERE hash=? AND wallet=? AND issued_at<=? AND expires_at>?").get(who.sessionHash, who.wallet, now, now)) throw new PublicProfileError("unauthenticated");
    return who;
  };
  const transaction = <T>(operation: () => T): T => { if (native) return native.transaction(operation); guard(); db.exec("BEGIN IMMEDIATE"); try { guard(); const result = operation(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const store = Object.freeze({
    async settings(input) { const who = actor(input); return settings(who.wallet); },
    async update(rawActor, rawInput) {
      native?.writeAccess();
      const who = actor(rawActor), input = publicProfileInput.parse(rawInput);
      if (input.published && input.fields.includes("ledgers")) native?.requireLedgers();
      const originals = new Map<string, { data: string; asker: unknown }>();
      if (input.published) for (const id of input.runIds) {
        const owned = await privacy.owner(id, who); native?.afterAwait(); if (!owned || owned.state.erased) throw new PublicProfileError("not_owned");
        const row = db.prepare("SELECT data,asker FROM query_runs WHERE id=?").get(id);
        if (!row || canonicalJson(JSON.parse(String(row.data))) !== canonicalJson(owned.run)) throw new PublicProfileError("not_owned");
        originals.set(id, { data: String(row.data), asker: row.asker });
      }
      return transaction(() => {
        actor(who); const current = profile(who.wallet); if (!current?.handle) throw new PublicProfileError("profile_required");
        if (settings(who.wallet).revision !== input.revision) throw new PublicProfileError("conflict");
        for (const [id, original] of originals) { const now=db.prepare("SELECT data,asker FROM query_runs WHERE id=?").get(id);
          if (now?.data !== original.data || now?.asker !== original.asker) throw new PublicProfileError("conflict"); }
        actor(who); // Fresh write-time expiry check after ownership and original validation.
        db.prepare(`INSERT INTO public_researcher_profiles VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET handle=excluded.handle,
          published=excluded.published,fields=excluded.fields,run_ids=excluded.run_ids,binding=excluded.binding,revision=excluded.revision,updated_at=excluded.updated_at`)
          .run(who.wallet,current.handle,input.published ? 1 : 0,JSON.stringify(input.fields),JSON.stringify(input.runIds),JSON.stringify(who.binding),input.revision+1,new Date().toISOString());
        return settings(who.wallet);
      });
    },
    async unpublish(rawActor) { native?.writeAccess(); transaction(() => { const who = actor(rawActor), current = profile(who.wallet);
      const existing = db.prepare("SELECT 1 FROM public_researcher_profiles WHERE wallet=?").get(who.wallet);
      if (!existing && !current?.handle) throw new PublicProfileError("profile_required");
      actor(who); // BEGIN IMMEDIATE excludes concurrent revoke; expiry is checked at the write.
      if (existing) db.prepare("UPDATE public_researcher_profiles SET published=0,revision=min(revision+1,2147483647),updated_at=? WHERE wallet=?").run(new Date().toISOString(),who.wallet);
      else db.prepare("INSERT INTO public_researcher_profiles VALUES(?,?,0,'[]','[]',?,1,?)")
        .run(who.wallet,current!.handle,JSON.stringify(who.binding),new Date().toISOString());
    }); },
    read: rawHandle => readPublication(rawHandle),
    async sitemap(rawTake) { guard(); const take=z.number().int().min(1).max(1000).parse(rawTake);
      return db.prepare(`SELECT s.handle,s.updated_at FROM public_researcher_profiles s JOIN private_profiles p ON p.wallet=s.wallet AND p.handle=s.handle WHERE s.published=1 ORDER BY s.handle LIMIT ?`).all(take)
        .map(row=>({handle:publicHandle.parse(row.handle),updatedAt:z.string().datetime().parse(row.updated_at)})); }
  } satisfies PublicProfilesStore);
  return { store, prepareRead: handle => readPublication(handle, true) };

  function readPublication(rawHandle: string): Promise<PublicProfileSnapshot | null>;
  function readPublication(rawHandle: string, defer: true): Promise<PublicProfileReadFinalizer>;
  async function readPublication(rawHandle: string, defer?: true) {
      guard(); const handle = publicHandle.parse(rawHandle);
      const publication = db.prepare(`SELECT s.* FROM public_researcher_profiles s JOIN private_profiles p ON p.wallet=s.wallet AND p.handle=s.handle WHERE s.handle=? AND s.published=1`).get(handle);
      if (!publication) return defer ? () => null : null;
      const wallet = String(publication.wallet), current = profile(wallet)!;
      const selected = publicProfileSettings.parse({ handle,published:true,fields:JSON.parse(String(publication.fields)),runIds:JSON.parse(String(publication.run_ids)),revision:publication.revision,updatedAt:publication.updated_at });
      if (selected.fields.includes("ledgers")) native?.requireLedgers();
      const binding = publicProfileActor.shape.binding.parse(JSON.parse(String(publication.binding)));
      const rows = db.prepare(`SELECT q.id,q.asker,q.data FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
        WHERE p.visibility='public' AND p.erased=0 AND q.id IN (SELECT value FROM json_each(?)) ORDER BY q.created_at DESC,q.id DESC LIMIT 50`).all(JSON.stringify(selected.runIds));
      const runs: PublicProfileSnapshot["runs"] = [];
      for (const row of rows) {
        const run = validatePrivacyRun(JSON.parse(String(row.data)),String(row.id)); let claimed = false;
        if (row.asker === wallet) { if (run.asker && run.asker.toLowerCase() !== wallet) throw new PublicProfileError("public_profile_unavailable"); }
        else { if (row.asker !== null || !history) continue; const proof = await history.read(wallet,binding,run.id); native?.afterAwait();
          if (!proof || proof.ownership.method !== "claimed" || canonicalJson(proof.run) !== canonicalJson(run)) continue; claimed = true; }
        const networks = db.prepare("SELECT DISTINCT network FROM payment_events WHERE query_id=? LIMIT 3").all(run.id).map(value => String(value.network));
        runs.push(publicRun(run,claimed,networks));
      }
      const verified = selected.fields.includes("verifiedLinks") ? identitySnapshotSchema.parse(await identities.list(wallet)).identities : undefined;
      if (verified) native?.afterAwait();
      if (verified?.some(value => value.wallet !== wallet)) throw new PublicProfileError("public_profile_unavailable");
      // Native reads invoke this private, same-store finalizer after their LAST
      // await. Ordinary reads invoke it immediately at the original boundary.
      const finalize: PublicProfileReadFinalizer = () => {
      // Recheck after awaited claim/identity reads so revocation/unpublish cannot publish a stale selection.
      guard(); const fresh = db.prepare("SELECT * FROM public_researcher_profiles WHERE wallet=? AND published=1 AND revision=?").get(wallet,publication.revision);
      const latest = profile(wallet); if (!fresh || latest?.handle !== handle || JSON.stringify(latest) !== JSON.stringify(current)) return null;
      if (verified) {
        const now = db.prepare("SELECT provider,external_id,label,verified_at FROM profile_verified_identities WHERE wallet=? AND external_id IS NOT NULL ORDER BY provider").all(wallet);
        if (JSON.stringify(now.map(row=>[row.provider,row.external_id,row.label,row.verified_at])) !==
          JSON.stringify([...verified].sort((a,b)=>a.provider.localeCompare(b.provider)).map(row=>[row.provider,row.externalId,row.label,row.verifiedAt]))) return null;
      }
      const stillPublic = new Set(rows.filter(row => db.prepare(`SELECT 1 FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
        WHERE q.id=? AND q.data=? AND q.asker IS ? AND p.visibility='public' AND p.erased=0`).get(String(row.id),String(row.data),row.asker!)).map(row=>String(row.id)));
      const ledgers = selected.fields.includes("ledgers") ? ["eip155:5042","eip155:5042002"].map(network => {
        const base = `FROM payment_events e LEFT JOIN query_runs q ON q.id=e.query_id WHERE e.network=? AND e.kind IN ('fetch','citation')
          AND e.settled=1 AND e.settlement_status='settled' AND e.amount_usdc>0 AND e.tx_hash IS NOT NULL AND length(trim(e.tx_hash))>0
          AND coalesce(json_extract(q.data,'$.paymentMode'),'')!='offline' AND coalesce(json_extract(q.data,'$.fundingOwner'),'')!='offline'`;
        const total = (condition: string, args: string[]) => db.prepare(`SELECT CASE WHEN count(*)=0 THEN '0' ELSE keryx_public_profile_micros(e.amount_usdc) END total ${base} AND ${condition}`).get(network,...args)?.total ?? null;
        return { network, readerPaidMicros: total("lower(e.payer)=? AND coalesce(json_extract(q.data,'$.fundingOwner'),'')!='treasury'",[wallet]),
          creatorEarnedMicros: total("lower(e.payee)=?",[wallet]),
          sponsoredCreatorPaymentsMicros: total("q.asker=? AND json_extract(q.data,'$.fundingOwner')='treasury'",[wallet]) };
      }) : undefined;
      return publicProfileSnapshot.parse({ version:1,handle,publishedAt:publication.updated_at,
        ...(selected.fields.includes("displayName") ? {displayName:current.displayName} : {}),
        ...(selected.fields.includes("about") ? {about:current.bio} : {}),...(selected.fields.includes("purpose") ? {purpose:current.purpose} : {}),
        ...(verified ? {verifiedLinks:verified.map(identity => ({provider:identity.provider,label:identity.label,url:identityUrl(identity),verifiedAt:identity.verifiedAt}))} : {}),
        ...(ledgers ? {ledgers,ledgerBasis:"wallet-wide-recorded-settled-creator-events"} : {}),runs:runs.filter(run=>stillPublic.has(run.id)),ownershipBasis:"signed-wallet-publication-existing-run-proof" });
      };
      return defer ? finalize : finalize();
  }
}

const nativeContention = (error: unknown) => error instanceof Error
  && "code" in error && error.code === "ERR_SQLITE_ERROR"
  && "errcode" in error && (error.errcode === 5 || error.errcode === 6);

/** ROOT composition on the SAME verified Full19 connection. Publication remains
 * opt-in in the existing application facade; this factory neither activates it nor
 * installs no schema or provider port. Exact BEFORE leaves it absent. All owner,
 * privacy and identity dependencies are composed here on this same connection. */
export function createEnrolledSqlitePublicProfiles(db: DatabaseSync): PublicProfilesStore | undefined {
  if (arguments.length !== 1) throw new PublicProfileError("public_profile_unavailable");
  const unavailable = () => new PublicProfileError("public_profile_unavailable");
  let verified = false, revoked = false;
  const revoke = () => {
    revoked = true;
    if (verified) try { db.close(); } catch { /* capability stays permanently revoked */ }
    return unavailable();
  };
  try {
    // Positive metadata first; no caller-provided guard or raw-native escape.
    assertVerifiedSqliteForeignKeys(db); verified = true;
    const identity = assertVerifiedSqliteConnection(db);
    if (identity.authorityMode !== "mainnet-real") throw unavailable();
    const schema = () => {
      if (revoked) throw unavailable();
      assertVerifiedSqliteForeignKeys(db);
      assertVerifiedSqliteConnection(db); // runtime/manifest/file/identity/fullshape
      assertStorageFences(db, identity);
      const fences = Object.keys(storageFenceStatements(db, identity));
      const profile = sqliteApplicationSchemaProfile(db, new Set([STORAGE_IDENTITY_TABLE,
        "storage_identity_no_update", "storage_identity_no_delete", "storage_identity_no_insert", ...fences]));
      // The ROOT-owned generator supplies exactly BEFORE/Full19, with/without
      // archive. No worker-specific profile, partial bundle or target DDL.
      const source = supportedSqliteApplicationProfiles(true);
      if (source.length !== 4) throw unavailable();
      if (profile === source[0] || profile === source[2]) return { profile, present: false };
      if (profile !== source[1] && profile !== source[3]) throw unavailable();
      assertVerifiedSqliteNativeUserDomainPolicy(db);
      return { profile, present: true };
    };
    const admitted = schema();
    if (!admitted.present) return undefined;
    // Source-owned same-store composition, never caller-supplied owner proof,
    // ordinary ports, optional claim fallback or provider/identity authority.
    const privacy = createEnrolledSqliteRunPrivacy(db);
    const identities = createEnrolledSqliteProfileIdentities(db);
    const history = createEnrolledSqliteRunOwnershipHistory(db);
    if (!identities) throw unavailable();
    const check = () => {
      try {
        if (revoked) throw unavailable();
        // Trusted Full19 opening pins the exact admitted family. Its full guard
        // rechecks manifest, held file, identity, fences and that opening profile.
        assertVerifiedSqliteNativeUserDomainPolicy(db);
        assertVerifiedSqliteConnection(db);
      } catch (error) {
        if (nativeContention(error)) throw error; // cleanup/proof belongs to request boundary below
        throw revoke();
      }
    };
    const writeAccess = () => {
      if (revoked) throw unavailable();
      // A readonly WRITE-FIRST call refuses before runtime guard or ANY SQL,
      // while retaining healthy read capability. Writable calls latch drift.
      try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); }
      check();
    };
    // Successful trusted Full19 opening installs the fixed aggregate before
    // issuing this existing positive policy. Registration never escapes sealing.
    const requireLedgers = () => { assertVerifiedSqliteNativeUserDomainPolicy(db); };
    const expectedRefusal = (error: unknown) => error instanceof PublicProfileError && error.code !== "public_profile_unavailable";
    const fail = (error: unknown): never => {
      if (revoked) throw unavailable();
      // A real native5/6 can preserve the connection only after cleanup and a
      // fresh positive guard. No retry of the denied operation or invented code.
      if (nativeContention(error) || expectedRefusal(error)) {
        try { if (db.isTransaction) throw unavailable(); check(); } catch { throw revoke(); }
        if (expectedRefusal(error)) throw error;
        throw unavailable();
      }
      throw revoke();
    };
    const transaction = <T>(operation: () => T): T => {
      let open = false;
      try {
        check(); if (db.isTransaction) throw unavailable();
        db.exec("BEGIN IMMEDIATE"); open = true; check();
        const result = operation(); check(); db.exec("COMMIT"); open = false; check(); return result;
      } catch (error) {
        if (open && !revoked) {
          try { db.exec("ROLLBACK"); open = false; if (db.isTransaction) throw unavailable(); check(); }
          catch { throw revoke(); }
        }
        // Preserve the genuine native code until the single request boundary;
        // translating it here would make the outer boundary misclassify it.
        if (nativeContention(error) || expectedRefusal(error)) throw error;
        return fail(error);
      }
    };
    const validateActor = (raw: PublicProfileActor) => {
      const who = publicProfileActor.parse(raw);
      if (who.binding.network !== identity.network) throw new PublicProfileError("unauthenticated");
    };
    const { store: body, prepareRead } = publicProfilesOperations(db, privacy, identities, history, check,
      { writeAccess, afterAwait: check, requireLedgers, transaction });
    const read = async <T>(operation: () => Promise<T>, validate: () => void): Promise<T> => {
      try { check(); } catch (error) { return fail(error); }
      // Caller validation is distinct from malformed stored data. Invalid input
      // cannot bypass admission, and does not revoke an otherwise healthy port.
      validate();
      try { const result = await operation(); check(); return result; }
      catch (error) { return fail(error); }
    };
    const readPublication = async (handle: string): Promise<PublicProfileSnapshot | null> => {
      try { check(); } catch (error) { return fail(error); }
      publicHandle.parse(handle);
      try {
        const finalize = await prepareRead(handle);
        check(); return finalize(); // No await between the full publication check and return.
      } catch (error) { return fail(error); }
    };
    const write = async <T>(operation: () => Promise<T>, validate: () => void): Promise<T> => {
      // Keep the metadata refusal outside the revoking boundary, before SQL.
      if (revoked) throw unavailable();
      try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); }
      return read(operation, validate);
    };
    return Object.freeze({
      settings: who => read(() => body.settings(who), () => { validateActor(who); }),
      read: readPublication,
      sitemap: take => read(() => body.sitemap(take), () => { z.number().int().min(1).max(1000).parse(take); }),
      update: (who, input) => write(() => body.update(who, input), () => { validateActor(who); publicProfileInput.parse(input); }),
      unpublish: who => write(() => body.unpublish(who), () => { validateActor(who); }),
    } satisfies PublicProfilesStore);
  } catch { throw revoke(); }
}
