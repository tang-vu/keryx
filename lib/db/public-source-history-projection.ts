import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { projectRecordedEvidenceProvenanceList, type EvidenceProvenanceLookup } from "../research/evidence-provenance";
import { PrivacyError, privacyId, publicSourceHistoryRowSchema, validatePrivacyRun, type PublicSourceHistoryRow } from "../run-privacy/contracts";

const text = ["id", "createdAt", "question", "engine"] as const;
const numbers = ["budget", "totalSpent", "totalToCreators"] as const;
const arrays = ["subClaims", "decisions", "citations", "trace"] as const;
const required = [...text, ...numbers, "answer", ...arrays] as const;
const optional = ["evidence", "claimCoverage"] as const;
const fields = [...required, ...optional] as const;
const rowSchema = z.object({ id: privacyId, data_bytes: z.number().int().nonnegative().max(4_000_000), fields: z.string() }).strict();
const metadataSchema = z.array(z.tuple([z.enum(fields), z.string(), z.unknown()])).min(required.length).max(fields.length);

function recordedProvenance(db: DatabaseSync, lookup: EvidenceProvenanceLookup): ReadonlySet<string> {
  // Same metadata-only source/item flags as the existing full-run SQLite reader.
  const flags = new Set<string>();
  for (const [table, ids] of [["sources", lookup.sourceIds], ["source_items", lookup.itemIds]] as const) {
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      if (batch.some(id => id.length > 256)) throw new Error("Invalid provenance lookup identity");
      const rows = db.prepare(`SELECT id${table === "source_items" ? ",source_id" : ""} FROM ${table} WHERE evidence_provenance='synthetic-demo' AND id IN (${batch.map(() => "?").join(",")})`).all(...batch);
      for (const row of rows) flags.add(table === "sources" ? `source:${row.id}` : `item:${row.source_id}:${row.id}`);
    }
  }
  return flags;
}

function decoded(type: string, value: unknown): unknown {
  if (type === "array" || type === "object") return typeof value === "string" ? JSON.parse(value) : value;
  if (type === "true") return true;
  if (type === "false") return false;
  return value;
}

function citationMetadata(raw: unknown) {
  const value = raw as Record<string, unknown> | null;
  const result: Record<string, unknown> = {};
  for (const key of ["sourceKind", "evidenceProvenance", "sourceName", "itemTitle", "itemUrl", "publicDeliveryKind"])
    if (typeof value?.[key] === "string") result[key] = value[key];
  const receipt = value?.contentReceipt as { bodyHash?: unknown } | null;
  if (typeof receipt?.bodyHash === "string") result.contentReceipt = { bodyHash: receipt.bodyHash };
  const provenance = value?.webProvenance as Record<string, unknown> | null;
  const web: Record<string, unknown> = {};
  for (const key of ["retrievedAt", "extraction"]) if (typeof provenance?.[key] === "string") web[key] = provenance[key];
  if (typeof provenance?.truncated === "boolean") web.truncated = provenance.truncated;
  if (Object.keys(web).length) result.webProvenance = web;
  return result;
}

/** Internal to the existing fresh guarded privacy port. No connection, caller
 * snapshot, cache, original writer or alternate storage authority is installed. */
export async function readSqlitePublicSourceHistory(db: DatabaseSync): Promise<PublicSourceHistoryRow[]> {
  try {
    const rows = db.prepare(`WITH chosen AS MATERIALIZED (
      SELECT q.id,q.created_at FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
      WHERE p.visibility='public' AND p.erased=0 ORDER BY q.created_at DESC,q.id DESC LIMIT 50)
      SELECT q.id,length(CAST(q.data AS BLOB)) AS data_bytes,
        CASE WHEN typeof(q.data)!='text' THEN NULL
          WHEN length(CAST(q.data AS BLOB))>4000000 THEN NULL
          WHEN instr(q.data,char(0))>0 THEN NULL
          WHEN json_valid(q.data)=0 THEN NULL ELSE (
          SELECT json_group_array(json_array(key,type,CASE WHEN key IN
            ('id','createdAt','budget','totalSpent','totalToCreators','answer','decisions','citations','evidence','claimCoverage') THEN value ELSE NULL END))
          FROM json_each(q.data) WHERE key IN (${fields.map(key => `'${key}'`).join(",")})) END AS fields
      FROM chosen c JOIN query_runs q ON q.id=c.id ORDER BY c.created_at DESC,c.id DESC`).all();
    const runs = rows.map(raw => {
      const row = rowSchema.parse(raw), metadata = metadataSchema.parse(JSON.parse(row.fields));
      const values = new Map(metadata.map(([key, type, value]) => [key, { type, value }]));
      if (values.size !== metadata.length || required.some(key => !values.has(key))) throw new PrivacyError("privacy_unavailable");
      for (const key of text) if (values.get(key)?.type !== "text") throw new PrivacyError("privacy_unavailable");
      for (const key of numbers) if (!["integer", "real"].includes(values.get(key)!.type)) throw new PrivacyError("privacy_unavailable");
      if (values.get("answer")?.type !== "text" || arrays.some(key => values.get(key)?.type !== "array") ||
          ["question", "engine", "subClaims", "trace"].some(key => values.get(key as typeof required[number])?.value !== null))
        throw new PrivacyError("privacy_unavailable");
      const kept = Object.fromEntries(metadata.filter(([key]) => !["question", "engine", "subClaims", "trace"].includes(key))
        .map(([key, type, value]) => [key, decoded(type, value)]));
      // Preserve all provenance-bearing arrays and the answer for the original
      // demotion logic. Omitted required fields were type-checked in SQLite.
      return validatePrivacyRun({ ...kept, question: "", engine: "", subClaims: [], trace: [] }, row.id);
    });
    const projected = await projectRecordedEvidenceProvenanceList(async lookup => recordedProvenance(db, lookup), runs);
    return projected.map(run => publicSourceHistoryRowSchema.parse({ id: run.id, createdAt: run.createdAt,
      hasAnswer: typeof run.answer === "string" && !!run.answer.trim(), citations: run.citations.slice(0, 100).map(citationMetadata) }));
  } catch (error) {
    if (error instanceof PrivacyError) throw error;
    throw new PrivacyError("privacy_unavailable");
  }
}
