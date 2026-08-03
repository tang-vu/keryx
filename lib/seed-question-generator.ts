/**
 * Effectively-infinite question generator for the volume engine.
 *
 * Previously, it asked the LLM for one fresh reader-style question seeded by
 * a random sample of the LIVE source registry's tags — so questions stay on-topic to whatever
 * creators are registered (and thus reliably produce real buy/cite activity) yet never repeat
 * verbatim. The discovery layer ranks any question against the marketplace by semantic similarity,
 * so generated questions don't need to be pre-matched to a source.
 *
 * Normal ticks now rotate through one source's current free previews and reject generated drift;
 * a separately configured exploration slice still probes beyond one source to measure real gaps.
 *
 * Works on both real LLM providers (Anthropic SDK and the OpenAI-compatible/DeepSeek HTTP API).
 * Falls back to a preview-anchored question (or the appropriate rotating bank when no preview is
 * available) on ANY generation failure — the 24/7 daemon must never stall on generation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config, llmProvider } from "./config";
import type { Source, SourceItem } from "./types";
import { pickGroundedQuestion, pickQuestion } from "./seed-questions";

export interface QuestionSourceContext {
  source: Source;
  /** Free discovery material only; paid item content never enters question generation. */
  items: Array<Pick<SourceItem, "title" | "summary">>;
}

export interface GenerateQuestionOptions {
  /** Deliberately probe beyond one preview to keep the demand board supplied with real gaps. */
  explore?: boolean;
}

const STOP = new Set(
  "the a an and or but of to in on for with at by from is are was were be been being this that these those what which who how why when where do does did can could should would will it its as into about more most than then over under article post source explain explains key points findings latest main improve improves work works".split(
    /\s+/,
  ),
);

function terms(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (word) => word.length > 2 && !STOP.has(word),
    ),
  );
}

function at<T>(items: T[], seed: number): T | undefined {
  if (items.length === 0) return undefined;
  return items[((seed % items.length) + items.length) % items.length];
}

function shorten(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > max * 0.65 ? boundary : max).trim()}...`;
}

/** Rotate sources with the persistent daemon cursor instead of repeatedly favoring one feed. */
export function contextForSeed(
  contexts: QuestionSourceContext[],
  seed: number,
): QuestionSourceContext | undefined {
  return at(
    contexts.filter(
      (context) =>
        context.source.active !== false &&
        context.source.verified !== false &&
        context.items.length > 0,
    ),
    seed,
  );
}

/** Deterministic answerable fallback when generation is unavailable or wanders off-preview. */
export function fallbackQuestionForContext(
  context: QuestionSourceContext,
  seed: number,
): string {
  const item = at(context.items, seed) ?? context.items[0]!;
  const title = shorten(item.title.replace(/["']/g, ""), 82);
  const tag = at((context.source.tags ?? []).filter(Boolean), seed);
  if (title.endsWith("?")) return title;
  return tag
    ? `What does "${title}" reveal about ${tag}?`
    : `What are the key findings in "${title}"?`;
}

/** High-recall drift gate: generic question boilerplate does not count as preview overlap. */
export function questionMatchesContext(
  question: string,
  context: QuestionSourceContext,
): boolean {
  const asked = terms(question);
  if (asked.size === 0) return false;
  const corpus = terms(
    [
      context.source.name,
      context.source.description,
      ...(context.source.tags ?? []),
      ...context.items.flatMap((item) => [item.title, item.summary]),
    ].join(" "),
  );
  let shared = 0;
  for (const term of asked) if (corpus.has(term)) shared++;
  return shared >= Math.min(2, asked.size);
}

export function buildGroundedQuestionPrompt(context: QuestionSourceContext): string {
  const previews = context.items
    .slice(0, 4)
    .map(
      (item, index) =>
        `${index + 1}. ${shorten(item.title, 160)}${
          item.summary.trim() ? ` - ${shorten(item.summary, 320)}` : ""
        }`,
    )
    .join("\n");
  return (
    `Publication: ${context.source.name}\n` +
    `Description: ${shorten(context.source.description, 280)}\n` +
    `Tags: ${(context.source.tags ?? []).join(", ")}\n` +
    `Recent free previews:\n${previews}\n\n` +
    "Write a question directly answerable from these previews. Use one or two concrete concepts " +
    "that appear above. Do not introduce an adjacent technology, product, or claim absent above."
  );
}

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
  "service. Vary the angle, depth, and phrasing each time. " +
  "8–18 words, end with '?'. Output ONLY the question — no preamble, no quotes.";

/** Raw single-shot text completion on whichever real provider is configured. */
async function chatText(system: string, user: string): Promise<string> {
  const provider = llmProvider();
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.anthropicKey });
    const msg = await client.messages.create(
      {
      model: config.llmModel, // same model the reasoning engine runs — valid in the daemon's env
      max_tokens: 64,
      temperature: 1,
      system,
        messages: [{ role: "user", content: user }],
      },
      { signal: AbortSignal.timeout(config.llmTimeoutMs) },
    );
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  // OpenAI-compatible (DeepSeek) — plain text, no JSON envelope.
  const baseUrl = provider === "mimo" ? config.mimoBaseUrl : config.llmBaseUrl;
  const apiKey = provider === "mimo" ? config.mimoKey : config.deepseekKey;
  const model = provider === "mimo" ? "mimo-v2.5" : config.llmModel;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(config.llmTimeoutMs),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
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
 * Generate a fresh question from one current preview, or from broad themes only in exploration.
 * `fallbackSeed` indexes the deterministic fallback used
 * whenever live generation is unavailable, so callers still get rotation (not a fixed question).
 */
export async function generateQuestion(
  contexts: QuestionSourceContext[],
  fallbackSeed: number,
  options: GenerateQuestionOptions = {},
): Promise<string> {
  const explore = options.explore === true;
  const selected = contextForSeed(contexts, fallbackSeed);
  const fallback = explore
    ? pickQuestion(fallbackSeed)
    : selected
      ? fallbackQuestionForContext(selected, fallbackSeed)
      : pickGroundedQuestion(fallbackSeed);
  if (llmProvider() === "heuristic") return fallback;

  const user = explore
    ? (() => {
        const tags = sampleTags(contexts.map((context) => context.source));
        return tags.length > 0 ? `Themes: ${tags.join(", ")}` : "";
      })()
    : selected
      ? buildGroundedQuestionPrompt(selected)
      : "";
  if (!user) return fallback;
  try {
    const q =
      (await chatText(SYSTEM, user))
        .trim()
        .split("\n")[0]
        ?.trim()
        .replace(/^["']|["']$/g, "") ?? "";
    // Guard against a malformed/empty completion — fall back rather than ask a junk question.
    const wellFormed = q.length >= 8 && q.endsWith("?");
    const grounded = explore || (!!selected && questionMatchesContext(q, selected));
    return wellFormed && grounded ? q : fallback;
  } catch {
    return fallback;
  }
}
