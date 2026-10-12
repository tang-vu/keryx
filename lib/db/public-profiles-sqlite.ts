import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { z } from "zod";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { assertRunPrivacySchema } from "./run-privacy-sqlite";
import { PRIVATE_PROFILES_SQL } from "./private-profiles-sqlite";
import { privateProfileRecordSchema } from "../profiles/private-profile";
import { identitySnapshotSchema, identityUrl, type ProfileIdentitiesStore } from "../profiles/verified-identities";
import type { RunPrivacyStore } from "../run-privacy/contracts";
import { validatePrivacyRun } from "../run-privacy/contracts";
import type { RunOwnershipHistoryStore } from "../run-claims/history";
import { PublicProfileError, publicHandle, publicProfileActor, publicProfileInput, publicProfileSettings,
  publicProfileSnapshot, type PublicProfilesStore, type PublicProfileActor } from "../profiles/public-profile";
import { publicRun, recordedMicros } from "../profiles/public-profile-projection";

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
  db.aggregate<string | null>("keryx_public_profile_micros", { start: "0", step: (total: string | null, amount: SQLOutputValue) => {
    const micros = recordedMicros(amount); return total === null || micros === null ? null : (BigInt(total) + BigInt(micros)).toString();
  } });
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
  const transaction = <T>(operation: () => T): T => { guard(); db.exec("BEGIN IMMEDIATE"); try { guard(); const result = operation(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  return Object.freeze({
    async settings(input) { const who = actor(input); return settings(who.wallet); },
    async update(rawActor, rawInput) {
      const who = actor(rawActor), input = publicProfileInput.parse(rawInput);
      const originals = new Map<string, { data: string; asker: unknown }>();
      if (input.published) for (const id of input.runIds) {
        const owned = await privacy.owner(id, who); if (!owned || owned.state.erased) throw new PublicProfileError("not_owned");
        const row = db.prepare("SELECT data,asker FROM query_runs WHERE id=?").get(id);
        if (!row || JSON.stringify(JSON.parse(String(row.data))) !== JSON.stringify(owned.run)) throw new PublicProfileError("not_owned");
        originals.set(id, { data: String(row.data), asker: row.asker });
      }
      return transaction(() => {
        actor(who); const current = profile(who.wallet); if (!current?.handle) throw new PublicProfileError("profile_required");
        if (settings(who.wallet).revision !== input.revision) throw new PublicProfileError("conflict");
        for (const [id, original] of originals) { const now=db.prepare("SELECT data,asker FROM query_runs WHERE id=?").get(id);
          if (now?.data !== original.data || now?.asker !== original.asker) throw new PublicProfileError("conflict"); }
        db.prepare(`INSERT INTO public_researcher_profiles VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET handle=excluded.handle,
          published=excluded.published,fields=excluded.fields,run_ids=excluded.run_ids,binding=excluded.binding,revision=excluded.revision,updated_at=excluded.updated_at`)
          .run(who.wallet,current.handle,input.published ? 1 : 0,JSON.stringify(input.fields),JSON.stringify(input.runIds),JSON.stringify(who.binding),input.revision+1,new Date().toISOString());
        return settings(who.wallet);
      });
    },
    async unpublish(rawActor) { transaction(() => { const who = actor(rawActor);
      db.prepare("UPDATE public_researcher_profiles SET published=0,revision=min(revision+1,2147483647),updated_at=? WHERE wallet=?").run(new Date().toISOString(),who.wallet); }); },
    async read(rawHandle) {
      guard(); const handle = publicHandle.parse(rawHandle);
      const publication = db.prepare(`SELECT s.* FROM public_researcher_profiles s JOIN private_profiles p ON p.wallet=s.wallet AND p.handle=s.handle WHERE s.handle=? AND s.published=1`).get(handle);
      if (!publication) return null;
      const wallet = String(publication.wallet), current = profile(wallet)!;
      const selected = publicProfileSettings.parse({ handle,published:true,fields:JSON.parse(String(publication.fields)),runIds:JSON.parse(String(publication.run_ids)),revision:publication.revision,updatedAt:publication.updated_at });
      const binding = publicProfileActor.shape.binding.parse(JSON.parse(String(publication.binding)));
      const rows = db.prepare(`SELECT q.id,q.asker,q.data FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
        WHERE p.visibility='public' AND p.erased=0 AND q.id IN (SELECT value FROM json_each(?)) ORDER BY q.created_at DESC,q.id DESC LIMIT 50`).all(JSON.stringify(selected.runIds));
      const runs = [];
      for (const row of rows) {
        const run = validatePrivacyRun(JSON.parse(String(row.data)),String(row.id)); let claimed = false;
        if (row.asker === wallet) { if (run.asker && run.asker.toLowerCase() !== wallet) throw new PublicProfileError("public_profile_unavailable"); }
        else { if (row.asker !== null || !history) continue; const proof = await history.read(wallet,binding,run.id);
          if (!proof || proof.ownership.method !== "claimed" || JSON.stringify(proof.run) !== JSON.stringify(run)) continue; claimed = true; }
        const networks = db.prepare("SELECT DISTINCT network FROM payment_events WHERE query_id=? LIMIT 3").all(run.id).map(value => String(value.network));
        runs.push(publicRun(run,claimed,networks));
      }
      const verified = selected.fields.includes("verifiedLinks") ? identitySnapshotSchema.parse(await identities.list(wallet)).identities : undefined;
      if (verified?.some(value => value.wallet !== wallet)) throw new PublicProfileError("public_profile_unavailable");
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
    },
    async sitemap(rawTake) { guard(); const take=z.number().int().min(1).max(1000).parse(rawTake);
      return db.prepare(`SELECT s.handle,s.updated_at FROM public_researcher_profiles s JOIN private_profiles p ON p.wallet=s.wallet AND p.handle=s.handle WHERE s.published=1 ORDER BY s.handle LIMIT ?`).all(take)
        .map(row=>({handle:publicHandle.parse(row.handle),updatedAt:z.string().datetime().parse(row.updated_at)})); }
  } satisfies PublicProfilesStore);
}
