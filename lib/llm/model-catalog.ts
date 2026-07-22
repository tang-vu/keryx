/**
 * Model catalog — the reasoning models an asker can pick, chat-app style.
 * Pure data (no env/config imports) so the browser picker can share it.
 *
 * `id` is the public identifier used in API payloads and the UI ("keryx:<id>" also
 * accepted on the OpenAI-compatible surface). `model` is the provider wire name.
 * DeepSeek is the default and the guaranteed fallback tier: any other pick that
 * errors falls back to it (then to the offline heuristic), so an ask always answers.
 */

export type ModelProvider = "deepseek" | "ollama";

export interface ModelChoice {
  /** Public id used in API payloads and the picker. Colon-free (`keryx:` prefixing). */
  id: string;
  /** Display name, chat-app style. */
  label: string;
  /** Which credential/endpoint serves it. */
  provider: ModelProvider;
  /** Model name sent on the wire to the provider. */
  model: string;
  /** One-line description for pickers. */
  note: string;
}

export const DEFAULT_MODEL_ID = "deepseek-chat";

export const MODEL_CATALOG: ModelChoice[] = [
  {
    id: "deepseek-chat",
    label: "DeepSeek V3",
    provider: "deepseek",
    model: "deepseek-chat",
    note: "The workhorse — fast, dependable, and the fallback for every other pick.",
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "ollama",
    model: "deepseek-v4-pro",
    note: "Deepest reasoning in the stable — thorough, noticeably slower.",
  },
  {
    id: "glm-5.2",
    label: "GLM 5.2",
    provider: "ollama",
    model: "glm-5.2",
    note: "Strong reasoning generalist (Zhipu).",
  },
  {
    id: "kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    provider: "ollama",
    model: "kimi-k2.7-code",
    note: "Code specialist (Moonshot).",
  },
  {
    id: "qwen3.5-397b",
    label: "Qwen 3.5 397B",
    provider: "ollama",
    model: "qwen3.5:397b",
    note: "Large open-weight generalist — thorough, noticeably slower.",
  },
  {
    id: "minimax-m3",
    label: "MiniMax M3",
    provider: "ollama",
    model: "minimax-m3",
    note: "Fast generalist with tool strength.",
  },
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: "ollama",
    model: "gpt-oss:120b",
    note: "OpenAI's open-weight model.",
  },
  {
    id: "gemma4",
    label: "Gemma 4",
    provider: "ollama",
    model: "gemma4",
    note: "Google's newest open-weight family.",
  },
];

/**
 * Look up a catalog entry by public id. Accepts the bare id or the `keryx:`-prefixed
 * form used on the OpenAI-compatible surface. Unknown → null (caller uses the default).
 */
export function findModelChoice(id?: string | null): ModelChoice | null {
  if (!id) return null;
  const bare = id.trim().replace(/^keryx:/, "");
  return MODEL_CATALOG.find((m) => m.id === bare) ?? null;
}
