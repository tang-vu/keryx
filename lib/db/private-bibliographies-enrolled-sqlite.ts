import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { paperReferencesBibtex } from "../papers/reference-export";
import { bibliographyIdSchema, bibliographyInputSchema, bibliographyMetadataSchema, bibliographyOwner, bibliographyRevisionSchema,
  bibliographyTokenSchema, MAX_BIBLIOGRAPHY_CONTENT_BYTES, MAX_PRIVATE_BIBLIOGRAPHIES, PrivateBibliographyError,
  type BibliographyInput, type PrivateBibliographiesStore } from "../bibliographies/private-bibliography";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { PRIVATE_BIBLIOGRAPHIES_STORAGE_DOMAIN as domain } from "./private-bibliographies-storage-domain";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy, assertVerifiedSqliteWritePolicy } from "./storage-identity-connection";
import { assertStorageFences, STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";

const unavailable = () => new PrivateBibliographyError("bibliography_unavailable");
const expectedDomain = canonicalJson(domain.schema);
const metadataColumns = "id,title,reference_count,revision,created_at,updated_at";
function metadata(row: Record<string, unknown>) {
  return bibliographyMetadataSchema.parse({ id: row.id, title: row.title, count: row.reference_count,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
}
function tokenHash(token: string) {
  return createHash("sha256").update(`keryx-private-bib-v1:${bibliographyTokenSchema.parse(token)}`).digest("hex");
}
function snapshot(raw: BibliographyInput) {
  const input = bibliographyInputSchema.parse(raw), output = paperReferencesBibtex(input.papers);
  if (Buffer.byteLength(output.content, "utf8") > MAX_BIBLIOGRAPHY_CONTENT_BYTES) throw new PrivateBibliographyError("bibliography_limit");
  return { title: input.title, content: output.content, count: output.count };
}

/** Internal same-selected-store composition. Genuine native provenance only;
 * no constructor DDL, raw capability, supplied guard or ordinary fallback. */
export function createEnrolledSqlitePrivateBibliographies(db: DatabaseSync): PrivateBibliographiesStore | undefined {
  if (arguments.length !== 1) throw unavailable();
  let identity: ReturnType<typeof assertVerifiedSqliteConnection>;
  try { identity = assertVerifiedSqliteConnection(db); } catch { throw unavailable(); }
  let revoked = false;
  const contention = (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
    && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
  const temporaryRefusals = new WeakSet<PrivateBibliographyError>();
  const revokeConnection = () => {
    revoked = true;
    try { db.close(); } catch { /* the port remains permanently revoked */ }
  };
  const schema = () => {
    if (revoked) throw unavailable();
    assertVerifiedSqliteConnection(db);
    assertStorageFences(db, identity);
    const fences = storageFenceStatements(db, identity);
    const excluded = new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
      "storage_identity_no_insert", ...Object.keys(fences)]);
    const profile = sqliteApplicationSchemaProfile(db, excluded);
    if (!supportedSqliteApplicationProfiles(identity.authorityMode === "mainnet-real").includes(profile)) throw unavailable();
    const rows = db.prepare(`SELECT type,name,tbl_name,substr(sql,1,16385) AS sql FROM sqlite_schema
      WHERE tbl_name='private_bibliographies' AND name NOT IN (?,?,?) ORDER BY type,name LIMIT 4`)
      .all(...domain.fences.map(fence => fence.name));
    if (rows.length) {
      if (identity.authorityMode !== "mainnet-real" || canonicalJson(rows) !== expectedDomain
        || domain.fences.some(fence => typeof fences[fence.name] !== "string")) throw unavailable();
    }
    return { profile, present: rows.length !== 0 };
  };
  let admitted: ReturnType<typeof schema>;
  try { admitted = schema(); } catch { revokeConnection(); throw unavailable(); }
  if (!admitted.present) return undefined;
  try { assertVerifiedSqliteNativeUserDomainPolicy(db); } catch { revokeConnection(); throw unavailable(); }
  const check = () => {
    if (revoked) throw unavailable();
    try {
      // Trusted opening already pins the exact complete source profile. Keep
      // its full guard, without rescanning it through the guarded SQL proxy.
      assertVerifiedSqliteNativeUserDomainPolicy(db); assertVerifiedSqliteConnection(db);
    } catch (error) {
      if (!contention(error)) revokeConnection();
      const refusal = unavailable();
      if (contention(error)) temporaryRefusals.add(refusal);
      throw refusal;
    }
  };
  const writeAccess = () => {
    // This WeakMap-only check performs NO SQL. Healthy actual readonly ports
    // keep their readers. Writable ports detect/revoke drift before input parsing.
    try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); }
    check();
  };
  const rollback = () => {
    try { db.exec("ROLLBACK"); check(); return true; }
    catch { revokeConnection(); return false; }
  };
  function transaction<T>(write: boolean, action: () => T): T {
    check();
    let started = false;
    try {
      db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN"); started = true;
      check(); const result = action(); check();
      db.exec("COMMIT"); started = false; check(); return result;
    } catch (error) {
      const benign = error instanceof PrivateBibliographyError && (error.code === "bibliography_not_found"
        || error.code === "bibliography_conflict" || error.code === "bibliography_limit");
      const temporary = contention(error) || error instanceof PrivateBibliographyError && temporaryRefusals.has(error);
      // Classify the originating failure before cleanup can observe restored guards.
      // Closing rolls back an acquired transaction and permanently latches refusal.
      if (!benign && !temporary) { revokeConnection(); throw unavailable(); }
      let intact = false;
      if (started) intact = rollback();
      else { try { check(); intact = true; } catch { /* already revoked */ } }
      if (intact && benign) throw error;
      throw unavailable();
    }
  }
  function owned(wallet: string, id: string, revision: number) {
    const row = db.prepare("SELECT id,revision FROM private_bibliographies WHERE wallet=? AND id=?").get(wallet, id);
    if (!row) throw new PrivateBibliographyError("bibliography_not_found");
    if (row.revision !== revision) throw new PrivateBibliographyError("bibliography_conflict");
  }
  return Object.freeze({
    async list(owner) {
      const wallet = bibliographyOwner(owner);
      return transaction(false, () => {
        const rows = db.prepare(`SELECT ${metadataColumns} FROM private_bibliographies WHERE wallet=? ORDER BY created_at,id LIMIT 21`).all(wallet);
        if (rows.length > MAX_PRIVATE_BIBLIOGRAPHIES) throw unavailable();
        return rows.map(metadata);
      });
    },
    async create(owner, raw) {
      writeAccess();
      const wallet = bibliographyOwner(owner), input = snapshot(raw), id = randomUUID(), token = randomBytes(32).toString("hex"), now = new Date().toISOString();
      return transaction(true, () => {
        const count = db.prepare("SELECT count(*) AS n FROM private_bibliographies WHERE wallet=?").get(wallet)!;
        if (Number(count.n) >= MAX_PRIVATE_BIBLIOGRAPHIES) throw new PrivateBibliographyError("bibliography_limit");
        db.prepare("INSERT INTO private_bibliographies(id,wallet,token_hash,title,content,reference_count,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(id, wallet, tokenHash(token), input.title, input.content, input.count, 1, now, now);
        return { bibliography: metadata(db.prepare(`SELECT ${metadataColumns} FROM private_bibliographies WHERE id=? AND wallet=?`).get(id, wallet)!), token };
      });
    },
    async replace(owner, rawId, raw, rawRevision) {
      writeAccess();
      const wallet = bibliographyOwner(owner), id = bibliographyIdSchema.parse(rawId), revision = bibliographyRevisionSchema.parse(rawRevision), input = snapshot(raw);
      return transaction(true, () => {
        owned(wallet, id, revision);
        if (revision === 2_147_483_647) throw new PrivateBibliographyError("bibliography_limit");
        const result = db.prepare("UPDATE private_bibliographies SET title=?,content=?,reference_count=?,revision=revision+1,updated_at=? WHERE id=? AND wallet=? AND revision=?")
          .run(input.title, input.content, input.count, new Date().toISOString(), id, wallet, revision);
        if (result.changes !== 1) throw new PrivateBibliographyError("bibliography_conflict");
        return metadata(db.prepare(`SELECT ${metadataColumns} FROM private_bibliographies WHERE id=? AND wallet=?`).get(id, wallet)!);
      });
    },
    async revoke(owner, rawId, rawRevision) {
      writeAccess();
      const wallet = bibliographyOwner(owner), id = bibliographyIdSchema.parse(rawId), revision = bibliographyRevisionSchema.parse(rawRevision);
      transaction(true, () => {
        owned(wallet, id, revision);
        const result = db.prepare("DELETE FROM private_bibliographies WHERE wallet=? AND id=? AND revision=?").run(wallet, id, revision);
        if (result.changes !== 1) throw new PrivateBibliographyError("bibliography_conflict");
      });
    },
    async read(token) {
      const hash = tokenHash(token);
      return transaction(false, () => {
        const row = db.prepare(`SELECT CASE WHEN length(CAST(content AS BLOB))<=${MAX_BIBLIOGRAPHY_CONTENT_BYTES}
          THEN content ELSE NULL END AS content FROM private_bibliographies WHERE token_hash=?`).get(hash);
        if (!row) return null;
        if (typeof row.content !== "string" || Buffer.byteLength(row.content, "utf8") > MAX_BIBLIOGRAPHY_CONTENT_BYTES) throw unavailable();
        return { content: row.content };
      });
    },
  } satisfies PrivateBibliographiesStore);
}
