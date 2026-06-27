/**
 * Effectively-infinite question generator for the volume engine.
 *
 * Instead of cycling a fixed bank, it asks the LLM for ONE fresh reader-style question seeded by
 * a random sample of the LIVE source registry's tags — so questions stay on-topic to whatever
 * creators are registered (and thus reliably produce real buy/cite activity) yet never repeat
 * verbatim. The discovery layer ranks any question against the marketplace by semantic similarity,
 * so generated questions don't need to be pre-matched to a source.
 *
 * Works on both real LLM providers (Anthropic SDK and the OpenAI-compatible/DeepSeek HTTP API).
 * Falls back to the static rotating bank in offline/heuristic mode or on ANY generation failure —
 * the 24/7 daemon must never stall on question generation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config, llmProvider } from "./config";
import type { Source } from "./types";
import { pickQuestion } from "./seed-questions";

/** Sample up to n distinct tags from the live registry to steer one generation. */
function sampleTags(sources: Source[], n = 6): string[] {
  const all = [...new Set(sources.flatMap((s) => s.tags ?? []))].filter(Boolean);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); // Fisher–Yates shuffle
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, n);
}

const SYSTEM =
  "You write ONE realistic question a curious reader or another AI agent would ask a research " +
  "service, grounded in the given themes. Vary the angle, depth, and phrasing each time. " +
  "8–18 words, end with '?'. Output ONLY the question — no preamble, no quotes.";

/** Raw single-shot text completion on whichever real provider is configured. */
async function chatText(system: string, user: string): Promise<string> {
  if (llmProvider() === "anthropic") {
    const client = new Anthropic({ apiKey: config.anthropicKey });
    const msg = await client.messages.create({
      model: config.llmModel, // same model the reasoning engine runs — valid in the daemon's env
      max_tokens: 64,
      temperature: 1,
      system,
      messages: [{ role: "user", content: user }],
    });
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  // OpenAI-compatible (DeepSeek) — plain text, no JSON envelope.
  const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.deepseekKey}` },
    body: JSON.stringify({
      model: config.llmModel,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 1,
      max_tokens: 64,
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Generate a fresh on-topic question. `fallbackSeed` indexes the deterministic static bank used
 * whenever live generation is unavailable, so callers still get rotation (not a fixed question).
 */
export async function generateQuestion(sources: Source[], fallbackSeed: number): Promise<string> {
  if (llmProvider() === "heuristic") return pickQuestion(fallbackSeed);
  const tags = sampleTags(sources);
  if (tags.length === 0) return pickQuestion(fallbackSeed);
  try {
    const q =
      (await chatText(SYSTEM, `Themes: ${tags.join(", ")}`))
        .trim()
        .split("\n")[0]
        ?.trim()
        .replace(/^["']|["']$/g, "") ?? "";
    // Guard against a malformed/empty completion — fall back rather than ask a junk question.
    return q.length >= 8 && q.endsWith("?") ? q : pickQuestion(fallbackSeed);
  } catch {
    return pickQuestion(fallbackSeed);
  }
}
