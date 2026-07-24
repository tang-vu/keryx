/**
 * refresh-feeds.mts — sweep every refreshable source (active + verified + has a feed) and
 * ingest anything published since the last pass, so listed blogs never freeze at their
 * register-day snapshot. New items become discoverable/purchasable immediately.
 *
 * Run:  npm run refresh-feeds     (wired into the traction daemon, once per tick)
 * Exit: always 0 — one dead blog must never stop the daemon loop; failures print per-source.
 */

import { getDb } from "../lib/db/index.ts";
import { refreshAllFeeds } from "../lib/ingest/refresh-feed.ts";

async function main(): Promise<void> {
  const db = await getDb();
  const results = await refreshAllFeeds(db);
  if (results.length === 0) {
    console.log("[refresh] nothing to sweep — no active+verified source lists a feed");
    return;
  }

  let added = 0;
  for (const r of results) {
    added += r.added;
    console.log(
      r.error
        ? `[refresh] ${r.name} (${r.sourceId}): FAILED — ${r.error}`
        : `[refresh] ${r.name} (${r.sourceId}): +${r.added} new (holds ${r.total})`,
    );
  }
  console.log(`[refresh] swept ${results.length} feed(s) — ${added} new item(s)`);
}

main().catch((err) => {
  // Still exit 0: the sweep is best-effort background upkeep, not a health gate.
  console.error("[refresh] sweep failed:", err instanceof Error ? err.message : err);
});
