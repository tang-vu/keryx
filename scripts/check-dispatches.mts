/**
 * check-dispatches.mts — outcome watchdog. Reads the agent's own recent dispatches and alerts when
 * they stop being model-reasoned, stop deciding, or stop paying anyone.
 *
 * The sibling watchdog (check-llm) asks the providers whether they can answer. This asks the only
 * question that settles the matter: did the last few hours of real runs decide and pay? Both halves
 * of the 2026-07-25 outage — a retired model name, then a decide reply truncated past its token
 * ceiling — left every probe and every dashboard reading healthy while creators earned nothing.
 * A window of live runs cannot lie about that.
 *
 * The compact verdict lands in sync_state (DISPATCH_HEALTH_STATE_KEY) where /api/health serves it
 * to /status, so a degraded window is public rather than buried in a cron log.
 *
 * Run:  npm run check-dispatches    (wired hourly via cron in deploy-vps.sh)
 * Exit: 0 the window looks healthy · 1 alarms raised (alert fired) · 2 the check itself failed
 * Env:  KERYX_DISPATCH_WINDOW_HOURS — look-back in hours (default 6)
 *       KERYX_ALERT_WEBHOOK — Discord/Slack webhook for the alert (optional; logs regardless)
 */

import { llmProvider } from "../lib/config.ts";
import { getDb } from "../lib/db/index.ts";
import { sendAlert } from "../lib/notify/alert.ts";
import {
  assessDispatchHealth,
  DEFAULT_WINDOW_HOURS,
  DISPATCH_HEALTH_STATE_KEY,
} from "../lib/ops/dispatch-health.ts";

/** Well above any plausible window: ~30 dispatches/day today, and a short read keeps the cron cheap. */
const READ_LIMIT = 200;

function windowHours(): number {
  const raw = Number(process.env.KERYX_DISPATCH_WINDOW_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WINDOW_HOURS;
}

async function main(): Promise<void> {
  const db = await getDb();
  const runs = await db.listRecentQueries(READ_LIMIT);

  if (runs.length === 0) {
    // A box that has never dispatched is a fresh install, not an outage.
    console.log("[dispatches] no dispatch on record yet — nothing to judge.");
    return;
  }

  const hours = windowHours();
  const summary = assessDispatchHealth(runs, {
    now: new Date(),
    windowHours: hours,
    expectReasoning: llmProvider() !== "heuristic",
  });

  console.log(
    `[dispatches] ${summary.runs} in ${hours}h — ${summary.modelReasoned} model-reasoned, ` +
      `${summary.partlyHeuristic} partly heuristic, ${summary.heuristic} heuristic, ` +
      `${summary.paying} paying, $${summary.creatorPayoutUsdc.toFixed(6)} to creators`,
  );

  // Persist BEFORE judging — /status should show a failing window too, not only a healthy one.
  await db.setSyncState(DISPATCH_HEALTH_STATE_KEY, JSON.stringify(summary));

  if (summary.alarms.length === 0) {
    console.log("[dispatches] OK — the agent is reasoning and creators are being paid.");
    return;
  }

  for (const alarm of summary.alarms) console.error(`[dispatches] ${alarm.code.toUpperCase()}: ${alarm.message}`);
  await sendAlert(
    `dispatch health: ${summary.alarms.map((a) => a.code).join(", ")}`,
    `${summary.alarms.map((a) => a.message).join(" · ")}. ` +
      `Window: ${summary.runs} dispatch(es)/${hours}h, $${summary.creatorPayoutUsdc.toFixed(6)} to creators. ` +
      `Run \`npm run check-llm\` for the provider side, then \`npm run ask -- "<q>" --budget 0.04\` on the box.`,
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("[dispatches] check failed:", err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
