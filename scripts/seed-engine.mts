/**
 * Volume engine — fires the Keryx agent over a stream of real questions to generate genuine
 * autonomous payment volume. Budget-guarded. This is how we show "real volume" without
 * needing thousands of humans. In real mode (funded wallet + KERYX_FORCE_OFFLINE=0) every
 * payment settles on Arc testnet.
 *
 * Usage:
 *   npm run seed -- --count 10 --budget 0.05 --delay 800
 *   npm run seed -- --loop --limit 2.0          (run until $2.00 total spent)
 *   npm run seed -- --count 20 --push           (also push traction via arc-canteen)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { collectRun, getAgentDeps } from "../lib/agent/index.ts";
import { SEED_QUESTIONS } from "../lib/seed-questions.ts";
import {
  generateQuestion,
  type QuestionSourceContext,
} from "../lib/seed-question-generator.ts";
import { newestContent, pickGapRetry, type RetryCandidate } from "../lib/demand-retry.ts";
import { availableModels, DEFAULT_MODEL_ID, getReasoningEngine } from "../lib/llm/index.ts";
import { config } from "../lib/config.ts";
import { buildBoard } from "../lib/demand-signal.ts";
import {
  finishGapIntentFromRun,
  GAP_INTENT_LEASE_MS,
  GAP_INTENT_MAX_ATTEMPTS,
  GAP_INTENT_MAX_BUDGET_USDC,
} from "../lib/gap-intent-runner.ts";
import {
  StaleGapIntentTargetError,
  validateGapIntentTarget,
} from "../lib/gap-intent-target.ts";

// ── args ──
const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? "") : def;
};
const has = (name: string) => argv.includes(`--${name}`);

const count = parseInt(flag("count", "10")!, 10);
const budget = parseFloat(flag("budget", "0.05")!);
const forcedModel = flag("model"); // pin every run to one catalog model (testing)
const delayMs = parseInt(flag("delay", "800")!, 10);
const limit = flag("limit") ? parseFloat(flag("limit")!) : Infinity;
const loop = has("loop");
const push = has("push");
const offsetArg = flag("offset");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Persistent question cursor. The 24/7 daemon fires a fresh `--count 1` process every tick,
// so a per-process index would always restart at question 0 — making the whole engine repeat
// the same first question forever. Reading/advancing a stored cursor rotates the full bank
// (incl. the broader real-world topics) across ticks. An explicit --offset overrides it.
const CURSOR_FILE = path.resolve(process.cwd(), "data", "seed-cursor.json");
function readCursor(): number {
  try {
    const n = JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8")).cursor;
    return Number.isFinite(n) ? ((n % SEED_QUESTIONS.length) + SEED_QUESTIONS.length) % SEED_QUESTIONS.length : 0;
  } catch {
    return 0;
  }
}
function writeCursor(next: number) {
  try {
    fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
    fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor: ((next % SEED_QUESTIONS.length) + SEED_QUESTIONS.length) % SEED_QUESTIONS.length }, null, 2));
  } catch {
    /* best-effort — never fail a traction run on cursor I/O */
  }
}

const useCursor = offsetArg === undefined;
const startOffset = useCursor ? readCursor() : parseInt(offsetArg!, 10) || 0;

const deps = await getAgentDeps();

// Model policy: Flash is the workhorse. A small, env-tuned slice of runs uses another catalog
// model for engine diversity — kept rare because those are slower and steady volume is the point.
const altModels = availableModels().filter((m) => m.id !== DEFAULT_MODEL_ID);
function pickRunModel(): string | undefined {
  if (forcedModel) return forcedModel;
  if (altModels.length === 0 || Math.random() >= config.engineAltModelRatio) return undefined;
  return altModels[Math.floor(Math.random() * altModels.length)].id;
}

console.log(`\n⚙  Keryx volume engine`);
console.log(`   engine: ${getReasoningEngine(forcedModel).name}  ·  mode: ${deps.gateway.mode}`);
if (!forcedModel && altModels.length > 0) {
  console.log(`   alt models: ${altModels.length} available @ ${(config.engineAltModelRatio * 100).toFixed(0)}% of runs`);
}
if (config.engineGapRetryRatio > 0) {
  console.log(`   gap retries: ${(config.engineGapRetryRatio * 100).toFixed(0)}% of runs re-ask an open /wanted claim (when content has arrived since)`);
}
console.log(
  `   question policy: ${((1 - config.engineQuestionExplorationRatio) * 100).toFixed(0)}% current-preview seeded / ${(config.engineQuestionExplorationRatio * 100).toFixed(0)}% exploration`,
);
console.log(`   budget/query: $${budget}  ·  spend cap: ${limit === Infinity ? "none" : "$" + limit}`);
console.log(`   ${loop ? "looping until cap" : `${count} queries`}  ·  delay ${delayMs}ms\n`);

if (deps.gateway.mode === "real") {
  console.log("   ⚠ REAL mode — settling on Arc testnet. Funding agent wallet…");
  const { address } = await deps.gateway.ensureFunded(Math.min(limit, budget * count));
  console.log(`   agent wallet: ${address}\n`);
}

// Snapshot only public discovery material. Normal questions rotate through one source's free
// previews; paid item content never enters question generation.
const sources = (await deps.db.listSources().catch(() => [])).filter(
  (source) => source.active !== false && source.verified !== false,
);
const questionContexts: QuestionSourceContext[] = (
  await Promise.all(
    sources.map(async (source) => ({
      source,
      items: (await deps.db.getItems(source.id).catch(() => []))
        .slice(0, 4)
        .map((item) => ({ title: item.title, summary: item.summary })),
    })),
  )
).filter((context) => context.items.length > 0);

// Some runs re-ask a question the corpus was paid for and left under-covered, rather than asking
// something new — but only when content has arrived since it failed, so the retry has a real chance
// of a different answer. The window is read fresh each time: in --loop mode an earlier retry in this
// same process must be visible, or the loop would re-ask one gap forever.
const RETRY_WINDOW_RUNS = 200;
const GAP_INTENT_WINDOW_RUNS = 400; // must match /wanted and registration validation
async function pickRetry(): Promise<RetryCandidate | null> {
  if (Math.random() >= config.engineGapRetryRatio) return null;
  try {
    const live = await deps.db.listSources();
    const arrived = newestContent(
      await deps.db.newestItemDates(live.map((s) => s.id)),
      live,
    );
    return pickGapRetry(await deps.db.listRecentQueries(RETRY_WINDOW_RUNS), arrived);
  } catch {
    return null; // a retry is an optimisation; never let it stop the engine asking something
  }
}

async function claimOpenGapIntent() {
  const intent = await deps.db
    .claimGapIntent(Date.now(), GAP_INTENT_LEASE_MS)
    .catch(() => null);
  if (!intent) return null;
  try {
    const stillOpen = buildBoard(
      await deps.db.listRecentQueries(GAP_INTENT_WINDOW_RUNS),
      { limit: GAP_INTENT_WINDOW_RUNS },
    ).open.some((gap) => gap.id === intent.gapId);
    if (stillOpen) {
      const targetAsset = await validateGapIntentTarget(deps.db, intent);
      return { intent, targetAsset };
    }
    await deps.db.expireGapIntent(
      intent.id,
      "The wanted claim closed before this source became eligible for retry.",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof StaleGapIntentTargetError) {
      await deps.db.expireGapIntent(intent.id, message).catch(() => {});
    } else {
      await deps.db
        .failGapIntent(intent.id, message, GAP_INTENT_MAX_ATTEMPTS)
        .catch(() => {});
    }
  }
  return null;
}

let totalSpent = 0;
let totalPayments = 0;
let i = 0;

async function maybePush(question: string, spent: number, payments: number) {
  if (!push) return;
  await new Promise<void>((resolve) => {
    const p = spawn(
      "arc-canteen",
      ["push", "--type", "traction", "--message", `Keryx: agent answered "${question.slice(0, 60)}" — paid ${payments} creators $${spent.toFixed(6)} USDC`],
      { stdio: "ignore", shell: true },
    );
    p.on("error", () => resolve());
    p.on("exit", () => resolve());
  });
}

while ((loop || i < count) && totalSpent < limit) {
  // Either re-ask a hole the corpus was paid for and missed, or ask something new. New questions
  // are LLM-generated, on-topic & effectively non-repeating; the cursor index is the deterministic
  // fallback seed used when no Anthropic key is set or generation fails.
  const claimedGap = await claimOpenGapIntent();
  const gapIntent = claimedGap?.intent ?? null;
  const retry = gapIntent ? null : await pickRetry();
  let freshQuestion: string | null = null;
  if (!gapIntent && !retry) {
    const explore = Math.random() < config.engineQuestionExplorationRatio;
    freshQuestion = await generateQuestion(questionContexts, startOffset + i, { explore });
  }
  const question = gapIntent
    ? gapIntent.question
    : retry
      ? retry.question
      : freshQuestion!;
  const runBudget = gapIntent
    ? Math.min(budget, config.defaultBudget, GAP_INTENT_MAX_BUDGET_USDC)
    : budget;
  const start = Date.now();
  try {
    // Per-run model pick — engine instances are cached, so this is a cheap map lookup.
    const modelId = pickRunModel();
    const runDeps = modelId ? { ...deps, engine: getReasoningEngine(modelId) } : deps;
    const run = await collectRun(
      {
        question,
        budget: runBudget,
        origin: "engine",
        ...(gapIntent
          ? {
              retryOf: gapIntent.failedQueryId,
              ...(claimedGap?.targetAsset ? { targetAsset: claimedGap.targetAsset } : {}),
            }
          : retry
            ? { retryOf: retry.queryId }
            : {}),
      },
      { deps: runDeps },
    );
    // Settlement already happened inside collectRun. Charge it to --limit before status
    // bookkeeping, or a transient result-write failure could make real spend invisible to the cap.
    totalSpent += run.totalSpent;
    totalPayments += run.citations.length + run.decisions.filter((d) => d.action === "BUY").length;
    const gapOutcome = gapIntent
      ? await finishGapIntentFromRun(deps.db, gapIntent, run)
      : null;
    const ms = Date.now() - start;
    console.log(
      `#${String(i + 1).padStart(3)} [$${totalSpent.toFixed(6)}] ${run.decisions.filter((d) => d.action === "BUY").length}b/${run.decisions.filter((d) => d.action === "SKIP").length}s → ${run.citations.length} cite(s) $${run.totalSpent.toFixed(6)} (${ms}ms)${modelId ? `  · ${modelId}` : ""}${gapIntent ? `  · wanted ${gapOutcome?.status} (${Math.round((gapOutcome?.coverage ?? 0) * 100)}%, $${(gapOutcome?.rewardUsdc ?? 0).toFixed(6)})` : retry ? `  · ↻ retry of ${retry.claim.slice(0, 40)}… (was ${Math.round(retry.coverage * 100)}%)` : ""}  «${question.slice(0, 52)}»`,
    );
    await maybePush(question, run.totalSpent, run.citations.length);
  } catch (err) {
    if (gapIntent) {
      await deps.db
        .failGapIntent(
          gapIntent.id,
          err instanceof Error ? err.message : String(err),
          GAP_INTENT_MAX_ATTEMPTS,
        )
        .catch(() => {});
    }
    console.error(`#${i + 1} FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
  i++;
  if ((startOffset + i) % SEED_QUESTIONS.length === 0 && loop) console.log("   …cycled question bank");
  await sleep(delayMs);
}

// Advance the shared cursor so the next process continues where this one stopped (skip when an
// explicit --offset was given, to keep such runs reproducible and not disturb the daemon's rotation).
if (useCursor) writeCursor(startOffset + i);

const m = await deps.db.metrics();
console.log(`\n✓ Engine stopped. ${i} queries this run.`);
console.log(`  Lifetime: ${m.totalPayments} payments · $${m.totalVolumeUsdc} to ${m.creatorsEarning} creators · ${(m.readerToPayerConversion * 100).toFixed(0)}% conversion\n`);
process.exit(0);
