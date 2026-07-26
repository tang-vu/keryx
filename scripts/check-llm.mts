/**
 * check-llm.mts — reasoning-provider watchdog. Asks every model the box is credentialed for to
 * answer one tiny prompt, and alerts when the default tier cannot.
 *
 * Why this exists: the reasoning chain is deliberately unkillable — an Ollama pick falls back to
 * DeepSeek, DeepSeek falls back to the deterministic heuristic — so a dead provider never breaks a
 * run. It quietly guts it instead. When DeepSeek retired the `deepseek-chat` wire name, every
 * reasoning step in production dropped to the heuristic and kept answering, kept settling real
 * USDC, and nothing surfaced it. Resilience without a watchdog just converts an outage into a
 * silent quality regression, which is worse: the agent's whole claim is that its buy/skip
 * decisions are model-reasoned.
 *
 * The probe is a real `decompose` call through the same engine the agent uses (no mock path), so it
 * fails for exactly the reasons a live run would: retired model name, bad key, quota, outage.
 *
 * Run:  npm run check-llm      (wired hourly via cron in deploy-vps.sh)
 * Exit: 0 the default tier answers · 1 it does not (alert fired) · 2 the check itself failed
 * Env:  KERYX_ALERT_WEBHOOK — Discord/Slack webhook for the alert (optional; logs regardless)
 */

import { config, llmProvider } from "../lib/config.ts";
import { availableModels, DEFAULT_MODEL_ID } from "../lib/llm/index.ts";
import { OpenAICompatibleEngine } from "../lib/llm/openai-compatible-engine.ts";
import { sendAlert } from "../lib/notify/alert.ts";
import type { ModelChoice } from "../lib/llm/model-catalog.ts";

const PROMPT = "Does a stablecoin settle instantly?";

/** One un-wrapped provider call — no resilience layer, so a failure surfaces instead of degrading. */
async function probe(m: ModelChoice): Promise<{ ok: true } | { ok: false; error: string }> {
  const engine = new OpenAICompatibleEngine({
    name: `llm:deepseek:${m.model}`,
    baseUrl: config.llmBaseUrl,
    apiKey: config.deepseekKey,
    model: m.model,
  });
  try {
    const claims = await engine.decompose(PROMPT);
    if (!Array.isArray(claims) || claims.length === 0) {
      return { ok: false, error: "answered with no usable sub-claims" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  if (llmProvider() === "heuristic") {
    console.log("[llm] no provider credentials — offline dev mode, nothing to probe.");
    return;
  }

  const models = availableModels();
  const results = await Promise.all(models.map(async (m) => ({ m, r: await probe(m) })));

  for (const { m, r } of results) {
    console.log(`[llm] ${r.ok ? "OK  " : "FAIL"} ${m.id} (${m.model})${r.ok ? "" : ` — ${r.error}`}`);
  }

  // The default tier is the one that matters: every other pick falls back onto it, so if it is
  // down the whole picker is really the heuristic wearing a model's name.
  const fallbackTier = results.find(({ m }) => m.id === DEFAULT_MODEL_ID);
  const broken = results.filter(({ r }) => !r.ok);

  if (fallbackTier && !fallbackTier.r.ok) {
    await sendAlert(
      `reasoning provider down — every run is answering from the heuristic`,
      `${fallbackTier.m.id} (${fallbackTier.m.model}) failed: ${"error" in fallbackTier.r ? fallbackTier.r.error : "unknown"}. ` +
        `Runs still complete and still settle real USDC, but their decisions are no longer model-reasoned. ` +
        `Check the model name against the provider's list, then set KERYX_LLM_MODEL / KERYX_SYNTHESIS_MODEL.`,
    );
    process.exitCode = 1;
    return;
  }

  if (broken.length > 0) {
    // A broken alternative pick degrades to the default tier, which is a real answer — worth
    // saying out loud, not worth waking anyone for.
    await sendAlert(
      `${broken.length} reasoning model${broken.length === 1 ? "" : "s"} unavailable (default tier is fine)`,
      broken
        .map(({ m, r }) => `${m.id} → ${"error" in r ? r.error : "unknown"}`)
        .join(" · "),
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[llm] all ${results.length} credentialed model(s) answering.`);
}

main().catch((err) => {
  console.error("[llm] check failed:", err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
