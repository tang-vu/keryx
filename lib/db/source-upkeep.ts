import type { DatabaseSync } from "node:sqlite";

export const SOURCE_UPKEEP_KEY = "sourceUpkeep";
export const SOURCE_UPKEEP_BATCH = 2;
export const SOURCE_UPKEEP_LEASE_MS = 120_000;

export interface SourceUpkeepClaim {
  slot: number;
  sourceIds: string[];
}

export interface SourceUpkeepSummary {
  attempted: number;
  added: number;
  failed: number;
  skipped: number;
}

interface State {
  slot: number;
  cursor: string;
  leaseUntil: number;
  completedAt?: string;
  summary?: SourceUpkeepSummary;
}

function readState(value: string): State {
  const state = JSON.parse(value) as Partial<State> | null;
  const integer = (number: unknown) => typeof number === "number" && Number.isSafeInteger(number) && number >= 0;
  if (!state || !integer(state.slot) || !integer(state.leaseUntil) ||
      typeof state.cursor !== "string" || state.cursor.length > 512 ||
      (state.completedAt !== undefined && (typeof state.completedAt !== "string" ||
        !Number.isFinite(Date.parse(state.completedAt)))) ||
      (state.summary !== undefined && (!state.summary ||
        !integer(state.summary.attempted) || state.summary.attempted > SOURCE_UPKEEP_BATCH ||
        !integer(state.summary.added) || state.summary.added > SOURCE_UPKEEP_BATCH * 10 ||
        !integer(state.summary.failed) || state.summary.failed > SOURCE_UPKEEP_BATCH ||
        !integer(state.summary.skipped) || state.summary.skipped > SOURCE_UPKEEP_BATCH))) {
    throw new Error("Invalid upkeep journal");
  }
  return state as State;
}

/** Consume the hourly allowance and advance the cursor BEFORE any network work.
 * A crash never retries the same slot; the next hour continues beyond a failed feed.
 * BEGIN IMMEDIATE serializes independent web/CLI processes sharing the SQLite file. */
export function claimSqliteSourceUpkeep(db: DatabaseSync, now: number): SourceUpkeepClaim | null {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid upkeep clock");
  const slot = Math.floor(now / 3_600_000);
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT value FROM sync_state WHERE key=?").get(SOURCE_UPKEEP_KEY);
    const state = row ? readState(String(row.value)) : null;
    if (state && (slot <= state.slot || now < state.leaseUntil)) {
      db.exec("COMMIT");
      return null;
    }
    const sources = db.prepare(`SELECT id FROM (
      SELECT id FROM sources WHERE active=1 AND verified=1 AND id NOT LIKE 'public:%'
        AND length(trim(coalesce(rss_url,'')))>0
      UNION ALL
      SELECT id FROM public_references WHERE active=1 AND length(trim(rss_url))>0
    ) ORDER BY CASE WHEN id > ? THEN 0 ELSE 1 END, id LIMIT ?`)
      .all(state?.cursor ?? "", SOURCE_UPKEEP_BATCH) as { id: string }[];
    const sourceIds = sources.map((source) => source.id);
    const next: State = {
      slot, cursor: sourceIds.at(-1) ?? state?.cursor ?? "",
      leaseUntil: now + SOURCE_UPKEEP_LEASE_MS,
    };
    db.prepare("INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES (?,?,?)")
      .run(SOURCE_UPKEEP_KEY, JSON.stringify(next), new Date(now).toISOString());
    db.exec("COMMIT");
    return { slot, sourceIds };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function finishSqliteSourceUpkeep(
  db: DatabaseSync, claim: SourceUpkeepClaim, summary: SourceUpkeepSummary, now: number,
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT value FROM sync_state WHERE key=?").get(SOURCE_UPKEEP_KEY);
    const state = row ? readState(String(row.value)) : null;
    if (state?.slot === claim.slot) {
      db.prepare("UPDATE sync_state SET value=?,updated_at=? WHERE key=?")
        .run(JSON.stringify({ ...state, leaseUntil: 0, completedAt: new Date(now).toISOString(), summary }),
          new Date(now).toISOString(), SOURCE_UPKEEP_KEY);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
