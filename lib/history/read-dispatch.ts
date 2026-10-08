import { getDb } from "../db";
import type { KeryxDB } from "../db";
import type { QueryRun } from "../types";
import { getTestnetArchive, type TestnetArchiveInfo } from "./testnet-archive";

/** A display reader cannot grant custody, reserve spending or settle a payment. */
export type DispatchReader = Pick<KeryxDB,
  "getQueryRun" | "listFollowUps" | "listPaymentsByQuery" | "listCreatorPaymentAttemptsByQuery">;

export interface ResolvedDispatch {
  run: QueryRun;
  reader: DispatchReader;
  archive: TestnetArchiveInfo | null;
}

export interface DispatchThread {
  parent: ResolvedDispatch | null;
  followUps: Array<{ run: QueryRun; archive: TestnetArchiveInfo | null }>;
  parentUnavailable: boolean;
  followUpsUnavailable: boolean;
}

/** Current records win. An unavailable current database is never treated as a missing record. */
export async function resolveDispatch(id: string, current?: DispatchReader): Promise<ResolvedDispatch | null> {
  const reader = current ?? await getDb();
  const run = await reader.getQueryRun(id);
  if (run) return { run, reader, archive: null };

  const archive = await getTestnetArchive();
  if (!archive) return null;
  const historical = await archive.getQueryRun(id);
  return historical ? { run: historical, reader: archive, archive: archive.info } : null;
}

/** Frozen parent evidence stays together; deliberate new follow-ups may cross the migration. */
export async function loadDispatchThread(dispatch: ResolvedDispatch, current: DispatchReader): Promise<DispatchThread> {
  const parent = async (): Promise<ResolvedDispatch | null> => {
    if (!dispatch.run.parentId) return null;
    if (!dispatch.archive) return resolveDispatch(dispatch.run.parentId, current);
    const run = await dispatch.reader.getQueryRun(dispatch.run.parentId);
    return run ? { run, reader: dispatch.reader, archive: dispatch.archive } : null;
  };
  const followUps = async () => {
    const [retained, live] = await Promise.allSettled([
      dispatch.reader.listFollowUps(dispatch.run.id),
      dispatch.archive ? current.listFollowUps(dispatch.run.id) : Promise.resolve([]),
    ]);
    const original = retained.status === "fulfilled" ? retained.value : [];
    const rows = new Map(original.map(run => [run.id, { run, archive: dispatch.archive }]));
    if (live.status === "fulfilled") {
      for (const run of live.value) rows.set(run.id, { run, archive: null });
    }
    return {
      rows: [...rows.values()].sort((a, b) => a.run.createdAt.localeCompare(b.run.createdAt) || a.run.id.localeCompare(b.run.id)),
      unavailable: retained.status === "rejected" || live.status === "rejected",
    };
  };
  // Enrichment is optional after the primary record was resolved successfully.
  // Preserve completed research during an archive/thread outage without inventing a parent.
  const [parentDispatch, children] = await Promise.allSettled([parent(), followUps()]);
  return {
    parent: parentDispatch.status === "fulfilled" ? parentDispatch.value : null,
    followUps: children.status === "fulfilled" ? children.value.rows : [],
    parentUnavailable: parentDispatch.status === "rejected",
    followUpsUnavailable: children.status === "rejected" || children.value.unavailable,
  };
}

/** Labels stay outside the immutable v1 receipt envelope, whose verifier rejects extra fields. */
export function historicalDispatchHeaders(archive: TestnetArchiveInfo | null): Record<string, string> {
  return archive ? {
    "X-Keryx-Archive-Network": archive.network,
    "X-Keryx-Archive-Captured-At": archive.capturedAt,
    "X-Keryx-Archive-Source-Commit": archive.sourceCommit,
    "X-Keryx-Archive-Database-Sha256": archive.databaseSha256,
  } : {};
}
