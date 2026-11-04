import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { PrivacyError, privacyId, publicQuestionIdsSchema, validatePrivacyRun, type PublicQuestion } from "../run-privacy/contracts";

const text = ["id", "createdAt", "question", "engine"] as const;
const numbers = ["budget", "totalSpent", "totalToCreators"] as const;
const arrays = ["subClaims", "decisions", "citations", "trace"] as const;
const fields = [...text, ...numbers, "answer", ...arrays] as const;
const rowSchema = z.object({ id: privacyId, data_bytes: z.number().int().nonnegative().max(4_000_000), fields: z.string() }).strict();
const fieldSchema = z.array(z.tuple([z.enum(fields), z.string(), z.unknown()])).length(fields.length);

/** Internal to the guarded privacy port. A question is no grant to read a run. */
export function readSqlitePublicQuestions(db: DatabaseSync, rawIds: string[]): PublicQuestion[] {
  try {
    const ids = publicQuestionIdsSchema.parse(rawIds);
    if (!ids.length) return [];
    const rows = db.prepare(`WITH chosen AS MATERIALIZED (
      SELECT q.id FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
      WHERE p.visibility='public' AND p.erased=0 AND q.id IN (SELECT value FROM json_each(?))
      ORDER BY q.created_at DESC,q.id DESC LIMIT 32)
      SELECT q.id,length(CAST(q.data AS BLOB)) AS data_bytes,
        CASE WHEN length(CAST(q.data AS BLOB))>4000000 THEN NULL ELSE (
          SELECT json_group_array(json_array(f.key,f.type,CASE
            WHEN f.key IN ('id','createdAt','question','engine') AND f.type='text'
              OR f.key IN ('budget','totalSpent','totalToCreators') AND f.type IN ('integer','real')
            THEN q.data -> f.fullkey ELSE NULL END))
          FROM json_each(q.data) f WHERE f.key IN
            ('id','createdAt','question','engine','budget','totalSpent','totalToCreators','answer','subClaims','decisions','citations','trace')
        ) END AS fields
      FROM chosen c JOIN query_runs q ON q.id=c.id
      ORDER BY q.created_at DESC,q.id DESC`).all(JSON.stringify(ids));
    return rows.map(raw => {
      const row = rowSchema.parse(raw), metadata = fieldSchema.parse(JSON.parse(row.fields));
      const values = new Map(metadata.map(([key, type, value]) => [key, { type, value }]));
      if (values.size !== fields.length || !ids.includes(row.id)) throw new PrivacyError("privacy_unavailable");
      for (const key of text) if (values.get(key)?.type !== "text") throw new PrivacyError("privacy_unavailable");
      for (const key of numbers) if (!["integer", "real"].includes(values.get(key)!.type)) throw new PrivacyError("privacy_unavailable");
      if (values.get("answer")?.type !== "text" || values.get("answer")?.value !== null ||
          arrays.some(key => values.get(key)?.type !== "array" || values.get(key)?.value !== null))
        throw new PrivacyError("privacy_unavailable");
      // Reuse the original required metadata validation. Heavy fields are only
      // type-checked in SQLite and represented by their empty shape here.
      const run = validatePrivacyRun({ ...Object.fromEntries([...text, ...numbers].map(key => [key, values.get(key)!.value])),
        answer: "", subClaims: [], decisions: [], citations: [], trace: [] }, row.id);
      return { id: run.id, question: run.question };
    });
  } catch (error) {
    // Preserve the native port's private contention/refusal identity.
    if (error instanceof PrivacyError) throw error;
    throw new PrivacyError("privacy_unavailable");
  }
}
