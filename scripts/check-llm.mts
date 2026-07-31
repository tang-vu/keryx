/**
 * Reasoning-provider watchdog. It probes every credentialed model without the resilience wrapper,
 * so a working fallback cannot hide a broken tier. The live run watchdog separately proves which
 * tiers actually served dispatches.
 *
 * Run:  npm run check-llm
 * Exit: 0 every configured model answers; 1 one or more do not; 2 the check itself failed
 */

import { config, llmProvider } from "../lib/config.ts";
import { AnthropicEngine } from "../lib/llm/anthropic-engine.ts";
import { availableModels } from "../lib/llm/index.ts";
import { OpenAICompatibleEngine } from "../lib/llm/openai-compatible-engine.ts";
import { endpointFor } from "../lib/llm/provider-endpoints.ts";
import { sendAlert } from "../lib/notify/alert.ts";
import type { ModelChoice } from "../lib/llm/model-catalog.ts";

const PROMPT = "Does a stablecoin settle instantly?";

type ProbeModel =
  | ModelChoice
  | {
      id: "anthropic-default";
      label: "Anthropic default";
      provider: "anthropic";
      model: string;
      note: string;
    };

async function probe(model: ProbeModel): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const engine =
      model.provider === "anthropic"
        ? new AnthropicEngine()
        : (() => {
            const endpoint = endpointFor(model.provider);
            if (!endpoint) throw new Error(`no credential configured for ${model.provider}`);
            return new OpenAICompatibleEngine({
              name: `llm:${model.provider}:${model.model}`,
              baseUrl: endpoint.baseUrl,
              apiKey: endpoint.apiKey,
              model: model.model,
            });
          })();
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
  const models: ProbeModel[] = [
    ...(config.anthropicKey
      ? [
          {
            id: "anthropic-default" as const,
            label: "Anthropic default",
            provider: "anthropic" as const,
            model: config.llmModel,
            note: "Configured Anthropic default",
          },
        ]
      : []),
    ...availableModels(),
  ];

  if (llmProvider() === "heuristic" && models.length === 0) {
    console.log("[llm] no provider credentials — offline dev mode, nothing to probe.");
    return;
  }

  const results = await Promise.all(models.map(async (model) => ({ model, result: await probe(model) })));
  for (const { model, result } of results) {
    console.log(
      `[llm] ${result.ok ? "OK  " : "FAIL"} ${model.id} (${model.model})${
        result.ok ? "" : ` — ${result.error}`
      }`,
    );
  }

  const broken = results.filter(({ result }) => !result.ok);
  if (broken.length === 0) {
    console.log(`[llm] all ${results.length} credentialed model(s) answering.`);
    return;
  }

  const details = broken
    .map(({ model, result }) => `${model.id} → ${"error" in result ? result.error : "unknown"}`)
    .join(" · ");
  const allBroken = broken.length === results.length;
  await sendAlert(
    allBroken
      ? "all reasoning providers down — dispatches will use the heuristic"
      : `${broken.length} reasoning model${broken.length === 1 ? "" : "s"} unavailable — failover active`,
    `${details}. ${
      allBroken
        ? "Runs still complete, but their decisions are no longer model-reasoned."
        : "Configured secondary providers keep paid dispatches model-reasoned."
    } Check provider status, credentials and wire model names.`,
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("[llm] check failed:", err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
