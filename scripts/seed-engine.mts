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
import { generateQuestion } from "../lib/seed-question-generator.ts";
import { getReasoningEngine } from "../lib/llm/index.ts";

// ── args ──
const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? "") : def;
};
const has = (name: string) => argv.includes(`--${name}`);

const count = parseInt(flag("count", "10")!, 10);
const budget = parseFloat(flag("budget", "0.05")!);
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
console.log(`\n⚙  Keryx volume engine`);
console.log(`   engine: ${getReasoningEngine().name}  ·  mode: ${deps.gateway.mode}`);
console.log(`   budget/query: $${budget}  ·  spend cap: ${limit === Infinity ? "none" : "$" + limit}`);
console.log(`   ${loop ? "looping until cap" : `${count} queries`}  ·  delay ${delayMs}ms\n`);

if (deps.gateway.mode === "real") {
  console.log("   ⚠ REAL mode — settling on Arc testnet. Funding agent wallet…");
  const { address } = await deps.gateway.ensureFunded(Math.min(limit, budget * count));
  console.log(`   agent wallet: ${address}\n`);
}

// Snapshot the live source registry once — its tags seed the LLM question generator so every
// query stays on-topic to whatever creators are actually registered.
const sources = await deps.db.listSources().catch(() => []);

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
  // LLM-generated, on-topic & effectively non-repeating; the cursor index is the deterministic
  // fallback seed used when no Anthropic key is set or generation fails.
  const question = await generateQuestion(sources, startOffset + i);
  const start = Date.now();
  try {
    const run = await collectRun({ question, budget, origin: "engine" }, { deps });
    totalSpent += run.totalSpent;
    totalPayments += run.citations.length + run.decisions.filter((d) => d.action === "BUY").length;
    const ms = Date.now() - start;
    console.log(
      `#${String(i + 1).padStart(3)} [$${totalSpent.toFixed(6)}] ${run.decisions.filter((d) => d.action === "BUY").length}b/${run.decisions.filter((d) => d.action === "SKIP").length}s → ${run.citations.length} cite(s) $${run.totalSpent.toFixed(6)} (${ms}ms)  «${question.slice(0, 52)}»`,
    );
    await maybePush(question, run.totalSpent, run.citations.length);
  } catch (err) {
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
