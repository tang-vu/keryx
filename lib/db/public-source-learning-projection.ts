import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { PrivacyError, privacyId, validatePrivacyRun, type PrivacyList, type PublicSourceLearningRun } from "../run-privacy/contracts";

const text = ["id", "createdAt", "question", "answer", "engine"] as const;
const numbers = ["budget", "totalSpent", "totalToCreators"] as const;
const arrays = ["subClaims", "decisions", "citations", "trace"] as const;
const required = [...text, ...numbers, ...arrays] as const;
const optional = ["usage", "sourceLearning", "paymentMode", "originalFulfillment", "asker", "provenance"] as const;
const fields = [...required, ...optional] as const;
const omitted = new Set<string>(["question", "answer", "engine", "subClaims", "citations", "trace"]);
const rowSchema = z.object({ id: privacyId, created_at: z.string(), privacy_revision: z.number().int().nonnegative(), data_bytes: z.number().int().nonnegative().max(4_000_000), fields: z.string() }).strict();
const metadataSchema = z.array(z.tuple([z.enum(fields), z.string(), z.unknown()])).min(required.length).max(fields.length);
const querySchema = z.object({ take: z.number().int().min(1).max(32), before: z.object({ id: privacyId, createdAt: z.string() }).strict().optional() }).strict();

function decoded(type: string, value: unknown): unknown {
  if (type === "array" || type === "object") return typeof value === "string" ? JSON.parse(value) : value;
  if (type === "true") return true;
  if (type === "false") return false;
  return value;
}

/** Fixed SQLite SOURCE expression only; it conveys no publication authority. */
export const SQLITE_PUBLIC_LEARNING_FIELDS = `CASE WHEN typeof(q.data)!='text' THEN NULL WHEN length(CAST(q.data AS BLOB))>4000000 THEN NULL
          WHEN instr(q.data,char(0))>0 THEN NULL WHEN json_valid(q.data)=0 THEN NULL ELSE (
          SELECT json_group_array(json_array(key,type,CASE
            WHEN key='originalFulfillment' THEN CASE WHEN type IN ('null','false') THEN 0
              WHEN type IN ('integer','real') THEN value!=0 WHEN type='text' THEN length(CAST(value AS BLOB))>0 ELSE 1 END
            WHEN key IN ('id','createdAt','budget','totalSpent','totalToCreators','decisions','usage','sourceLearning','paymentMode','asker','provenance') THEN value
            ELSE NULL END)) FROM json_each(q.data) WHERE key IN (${fields.map(key => `'${key}'`).join(",")})) END`;

/** Called only inside the existing fresh guarded privacy port. The SQL snapshot
 * filters publication before loading metadata; no original body or grant cache. */
export function readSqlitePublicLearningPage(db: DatabaseSync, input: Pick<PrivacyList, "take" | "before">): PublicSourceLearningRun[] {
  try {
    const query = querySchema.parse(input), args: (string | number)[] = [];
    const before = query.before ? " AND (q.created_at<? OR (q.created_at=? AND q.id<?))" : "";
    if (query.before) args.push(query.before.createdAt, query.before.createdAt, query.before.id);
    args.push(query.take);
    const rows = db.prepare(`/* keryx_source_learning_projection_v1 */ WITH chosen AS MATERIALIZED (
      SELECT q.id,q.created_at,p.revision AS privacy_revision FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
      WHERE p.visibility='public' AND p.erased=0${before} ORDER BY q.created_at DESC,q.id DESC LIMIT ?)
      SELECT q.id,q.created_at,c.privacy_revision,length(CAST(q.data AS BLOB)) AS data_bytes,
        ${SQLITE_PUBLIC_LEARNING_FIELDS} AS fields
      FROM chosen c JOIN query_runs q ON q.id=c.id ORDER BY c.created_at DESC,c.id DESC`).all(...args);
    return decodeSqlitePublicLearningRows(rows);
  } catch (error) {
    if (error instanceof PrivacyError) throw error;
    throw new PrivacyError("privacy_unavailable");
  }
}

/** Pure validation of storage-filtered learning metadata; no publication grant. */
export function decodeSqlitePublicLearningRows(rawRows:unknown):PublicSourceLearningRun[]{
 const rows=z.array(z.unknown()).max(32).parse(rawRows);
 return rows.map(raw => {
      const row = rowSchema.parse(raw), metadata = metadataSchema.parse(JSON.parse(row.fields));
      const values = new Map(metadata.map(([key, type, value]) => [key, { type, value }]));
      if (values.size !== metadata.length || required.some(key => !values.has(key)) ||
          text.some(key => values.get(key)?.type !== "text") || arrays.some(key => values.get(key)?.type !== "array") ||
          numbers.some(key => !["integer", "real"].includes(values.get(key)!.type)) ||
          metadata.some(([key, , value]) => omitted.has(key) && value !== null)) throw new PrivacyError("privacy_unavailable");
      const kept = Object.fromEntries(metadata.filter(([key]) => !omitted.has(key)).map(([key, type, value]) => [key, decoded(type, value)]));
      const run = validatePrivacyRun({ ...kept, question: "", answer: "", engine: "", subClaims: [], citations: [], trace: [] }, row.id);
      if (run.createdAt !== row.created_at) throw new PrivacyError("privacy_unavailable");
      return { id: run.id, createdAt: run.createdAt, usage: run.usage, sourceLearning: run.sourceLearning,
        paymentMode: run.paymentMode, originalFulfillment: !!run.originalFulfillment, asker: run.asker, provenance: run.provenance,
        decisions: run.decisions.map(decision => ({ sourceId: decision.sourceId })) };
    });
}
