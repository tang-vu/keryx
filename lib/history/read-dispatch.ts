import { getDb } from "../db";
import type { KeryxDB } from "../db";
import type { QueryRun } from "../types";
import { getTestnetArchive, type TestnetArchiveInfo } from "./testnet-archive";
import { requirePrivacy, type PrivacyActor, type RunVisibility } from "../run-privacy/contracts";

/** A display reader cannot grant custody, reserve spending or settle a payment. */
export type DispatchReader = Pick<KeryxDB,
  "getQueryRun" | "listFollowUps" | "listPaymentsByQuery" | "listCreatorPaymentAttemptsByQuery" | "runPrivacy">;

export interface ResolvedDispatch {
  run: QueryRun;
  reader: DispatchReader;
  archive: TestnetArchiveInfo | null;
  visibility?: RunVisibility;
}

export interface DispatchThread {
  parent: ResolvedDispatch | null;
  followUps: Array<{ run: QueryRun; archive: TestnetArchiveInfo | null }>;
  parentUnavailable: boolean;
  followUpsUnavailable: boolean;
}

/** Current records win. An unavailable current database is never treated as a missing record. */
export async function resolveDispatch(id: string, current?: DispatchReader, actor?: PrivacyActor): Promise<ResolvedDispatch | null> {
  const reader = current ?? await getDb();
  const value=await requirePrivacy(reader).read(id,actor);
  if (value.item) return { run:value.item.run, reader, archive:null,visibility:value.item.state.visibility };
  if (value.exists) return null;

  const archive = await getTestnetArchive();
  if (!archive) return null;
  const historical = await archive.getQueryRun(id);
  return historical ? { run: historical, reader: archive, archive: archive.info,visibility:"unlisted" } : null;
}

/** Frozen parent evidence stays together; deliberate new follow-ups may cross the migration. */
export async function loadDispatchThread(dispatch: ResolvedDispatch, current: DispatchReader, actor?: PrivacyActor): Promise<DispatchThread> {
  const parent = async (): Promise<ResolvedDispatch | null> => {
    if (!dispatch.run.parentId) return null;
    if(dispatch.archive) {
      const live=await requirePrivacy(current).read(dispatch.run.parentId,actor);
      if(live.exists&&!live.item)return null;
      const run=await dispatch.reader.getQueryRun(dispatch.run.parentId);
      return run?{run,reader:dispatch.reader,archive:dispatch.archive,visibility:"unlisted" as const}:null;
    }
    return resolveDispatch(dispatch.run.parentId,current,actor);
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
