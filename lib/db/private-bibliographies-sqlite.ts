import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { paperReferencesBibtex } from "../papers/reference-export";
import { bibliographyIdSchema, bibliographyInputSchema, bibliographyMetadataSchema, bibliographyOwner, bibliographyRevisionSchema,
  bibliographyTokenSchema, MAX_BIBLIOGRAPHY_CONTENT_BYTES, MAX_PRIVATE_BIBLIOGRAPHIES, PrivateBibliographyError,
  type BibliographyInput, type PrivateBibliographiesStore } from "../bibliographies/private-bibliography";

export const PRIVATE_BIBLIOGRAPHIES_SQL = `CREATE TABLE IF NOT EXISTS private_bibliographies (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL CHECK(length(wallet)=42 AND wallet=lower(wallet) AND substr(wallet,1,2)='0x' AND substr(wallet,3) NOT GLOB '*[^0-9a-f]*'),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  content TEXT NOT NULL CHECK(length(CAST(content AS BLOB))<=${MAX_BIBLIOGRAPHY_CONTENT_BYTES}),
  reference_count INTEGER NOT NULL CHECK(reference_count BETWEEN 0 AND 50),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);`;
const shape = (db: DatabaseSync) => db.prepare("SELECT type,name,tbl_name,substr(sql,1,16385) AS sql FROM sqlite_schema WHERE tbl_name='private_bibliographies' ORDER BY type,name LIMIT 6").all();
let expectedShape: string | undefined;
function assertShape(db: DatabaseSync) {
  if (!expectedShape) {
    const reference = new DatabaseSync(":memory:");
    try { reference.exec(PRIVATE_BIBLIOGRAPHIES_SQL); expectedShape = JSON.stringify(shape(reference)); }
    finally { reference.close(); }
  }
  if (JSON.stringify(shape(db)) !== expectedShape) throw new PrivateBibliographyError("bibliography_unavailable");
}
function tokenHash(token: string) {
  return createHash("sha256").update(`keryx-private-bib-v1:${bibliographyTokenSchema.parse(token)}`).digest("hex");
}
function snapshot(raw: BibliographyInput) {
  const input = bibliographyInputSchema.parse(raw), output = paperReferencesBibtex(input.papers);
  if (Buffer.byteLength(output.content, "utf8") > MAX_BIBLIOGRAPHY_CONTENT_BYTES) throw new PrivateBibliographyError("bibliography_limit");
  return { title: input.title, content: output.content, count: output.count };
}
function metadata(row: Record<string, unknown>) {
  return bibliographyMetadataSchema.parse({ id: row.id, title: row.title, count: row.reference_count,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
}

/** Additive ordinary-only domain. It never joins profiles, research, receipts or payment history. */
export function createSqlitePrivateBibliographies(db: DatabaseSync): PrivateBibliographiesStore {
  assertOrdinarySqliteResearchAuthority(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    assertOrdinarySqliteResearchAuthority(db);
    if (shape(db).length) assertShape(db);
    db.exec(PRIVATE_BIBLIOGRAPHIES_SQL); assertShape(db); db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  function transaction<T>(write: boolean, action: () => T): T {
    assertOrdinarySqliteResearchAuthority(db);
    db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try { assertOrdinarySqliteResearchAuthority(db); assertShape(db); const result = action(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); if (error instanceof PrivateBibliographyError) throw error; throw new PrivateBibliographyError("bibliography_unavailable"); }
  }
  function owned(owner: string, id: string, revision: number) {
    const row = db.prepare("SELECT * FROM private_bibliographies WHERE wallet=? AND id=?").get(bibliographyOwner(owner), bibliographyIdSchema.parse(id));
    if (!row) throw new PrivateBibliographyError("bibliography_not_found");
    if (row.revision !== bibliographyRevisionSchema.parse(revision)) throw new PrivateBibliographyError("bibliography_conflict");
    return row;
  }
  return Object.freeze({
    async list(owner) {
      const wallet = bibliographyOwner(owner);
      return transaction(false, () => {
        const rows = db.prepare("SELECT id,title,reference_count,revision,created_at,updated_at FROM private_bibliographies WHERE wallet=? ORDER BY created_at,id LIMIT 21").all(wallet);
        if (rows.length > MAX_PRIVATE_BIBLIOGRAPHIES) throw new PrivateBibliographyError("bibliography_unavailable");
        return rows.map(metadata);
      });
    },
    async create(owner, raw) {
      const wallet = bibliographyOwner(owner), input = snapshot(raw), id = randomUUID(), token = randomBytes(32).toString("hex"), now = new Date().toISOString();
      return transaction(true, () => {
        const count = db.prepare("SELECT count(*) AS n FROM private_bibliographies WHERE wallet=?").get(wallet)!;
        if (Number(count.n) >= MAX_PRIVATE_BIBLIOGRAPHIES) throw new PrivateBibliographyError("bibliography_limit");
        db.prepare("INSERT INTO private_bibliographies VALUES(?,?,?,?,?,?,?,?,?)").run(id, wallet, tokenHash(token), input.title, input.content, input.count, 1, now, now);
        return { bibliography: metadata(db.prepare("SELECT * FROM private_bibliographies WHERE id=?").get(id)!), token };
      });
    },
    async replace(owner, id, raw, revision) {
      const input = snapshot(raw);
      return transaction(true, () => {
        const row = owned(owner, id, revision);
        if (revision === 2_147_483_647) throw new PrivateBibliographyError("bibliography_limit");
        db.prepare("UPDATE private_bibliographies SET title=?,content=?,reference_count=?,revision=revision+1,updated_at=? WHERE id=? AND wallet=?").run(input.title, input.content, input.count, new Date().toISOString(), row.id as string, bibliographyOwner(owner));
        return metadata(db.prepare("SELECT * FROM private_bibliographies WHERE id=?").get(id)!);
      });
    },
    async revoke(owner, id, revision) {
      transaction(true, () => { owned(owner, id, revision); db.prepare("DELETE FROM private_bibliographies WHERE wallet=? AND id=?").run(bibliographyOwner(owner), id); });
    },
    async read(token) {
      const hash = tokenHash(token);
      return transaction(false, () => {
        const row = db.prepare("SELECT content FROM private_bibliographies WHERE token_hash=?").get(hash);
        if (!row) return null;
        if (typeof row.content !== "string" || Buffer.byteLength(row.content, "utf8") > MAX_BIBLIOGRAPHY_CONTENT_BYTES) throw new PrivateBibliographyError("bibliography_unavailable");
        return { content: row.content };
      });
    },
  } satisfies PrivateBibliographiesStore);
}
