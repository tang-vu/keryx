import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { PrivacyError, privacyReadsActive, publicQuestionIdsSchema, publicQuestionSchema, requirePrivacy } from "./contracts";

/** Bounded per-operation enrichment, never a publication cache or financial grant. */
export async function listedQuestions(db: Pick<KeryxDB, "runPrivacy" | "runPrivacyActive"> & Partial<Pick<KeryxDB, "getQueryRun">>, rawIds: string[]): Promise<Map<string, string>> {
  let ids: string[];
  try { ids = [...new Set(z.array(z.string()).max(32).parse(rawIds))]; }
  catch { throw new PrivacyError("privacy_unavailable"); }
  const result = new Map<string, string>();
  if (!ids.length) return result;
  if (!privacyReadsActive(db)) {
    const questions = await Promise.all(ids.map(async id => ({ id, question: (await db.getQueryRun?.(id))?.question })));
    for (const row of questions) if (row.question) result.set(row.id, row.question);
    return result;
  }
  const store = requirePrivacy(db);
  let requested: string[];
  try { requested = publicQuestionIdsSchema.parse(ids); }
  catch { throw new PrivacyError("privacy_unavailable"); }
  // A missing optional reader uses the original guarded list once. An error in
  // an available reader never selects a legacy, raw or stale-text fallback.
  const slim = !!store.questions;
  const rows = slim ? await store.questions!(requested) : await store.list({ take: requested.length, ids: requested });
  try {
    const projected = slim ? rows : rows.map(row => ({ id: row.id, question: row.question }));
    const parsed = z.array(publicQuestionSchema).max(requested.length).parse(projected);
    const seen = new Set<string>();
    for (const row of parsed) {
      if (!requested.includes(row.id) || seen.has(row.id)) throw new PrivacyError("privacy_unavailable");
      seen.add(row.id);
      if (row.question) result.set(row.id, row.question);
    }
    return result;
  } catch (error) {
    if (error instanceof PrivacyError) throw error;
    throw new PrivacyError("privacy_unavailable");
  }
}
