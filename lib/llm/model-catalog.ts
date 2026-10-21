/**
 * Model catalog — the reasoning models an asker can pick, chat-app style.
 * Pure data (no env/config imports) so the browser picker can share it.
 *
 * `id` is the public identifier used in API payloads and the UI ("keryx:<id>" also
 * accepted on the OpenAI-compatible surface). `model` is the provider wire name.
 * Flash is the default workhorse. Any picked model that errors crosses the other configured
 * provider defaults before the offline heuristic. A guarded or failed run may still refuse.
 *
 * The catalog once carried seven open-weight models routed through Ollama Cloud. That account is
 * gone, and a picker offering models that answer only by silently falling back to DeepSeek is a
 * promise the product cannot keep — so they are retired rather than left on the shelf. Every entry
 * left is served by a credential the box actually holds; `provider-endpoints.ts` decides which, and
 * an entry whose provider is uncredentialed is filtered out of the picker rather than offered.
 */

export type ModelProvider = "deepseek" | "cloudflare";

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
  /** Offered only for explicit selection; excluded from automatic supplier probes. */
  manualOnly?: boolean;
  /** Ordinary staged option; retained private/bounded policies keep their fixed transport. */
  routineModel?: string;
}

export const DEFAULT_MODEL_ID = "deepseek-flash";

/**
 * Ids that no longer exist upstream, mapped to what replaced them. A public id is a contract:
 * API callers, saved widget embeds and the OpenAI-compatible surface all pass these strings, so a
 * retired id must keep resolving rather than silently drop the caller to the default.
 */
const RETIRED_IDS: Record<string, string> = {
  // Canonical Flash serves V4.1. Retained aliases remain readable without rewriting old runs.
  "deepseek-chat": "deepseek-flash",
  "deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4-flash-vision-exp": "deepseek-flash",
  // The open-weight tier is gone with the Ollama Cloud account. Every one of these ids may still be
  // sitting in a saved widget embed or someone's API client, so they resolve to the workhorse
  // instead of 400-ing — which is what the picker did for them at the end anyway.
  "glm-5.2": "deepseek-flash",
  "kimi-k2.7-code": "deepseek-flash",
  "qwen3.5-397b": "deepseek-flash",
  "minimax-m3": "deepseek-flash",
  "gpt-oss-120b": "deepseek-flash",
  gemma4: "deepseek-flash",
};

export const MODEL_CATALOG: ModelChoice[] = [
  {
    id: "deepseek-flash",
    label: "DeepSeek V4.1 Flash",
    provider: "deepseek",
    model: "deepseek-flash",
    note: "Default research model. Lower published cost; quality still depends on the task and evidence.",
  },
  {
    id: "deepseek-balanced",
    label: "DeepSeek Balanced",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    routineModel: "deepseek-flash",
    note: "Flash plans, selects sources, checks coverage and assigns contributions; Pro synthesizes and reviews evidence. Provider fallback remains visible.",
    manualOnly: true,
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro 0813",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    note: "Explicit comparison option with a higher published price; not automatically better than V4.1 Flash.",
    manualOnly: true,
  },
  {
    id: "cloudflare-llama-3.3",
    label: "Llama 3.3 · Cloudflare (experimental)",
    provider: "cloudflare",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    note: "Optional bounded third provider; smaller research contexts only.",
  },
  {
    id: "cloudflare-gpt-oss-120b",
    label: "GPT-OSS 120B · Cloudflare (experimental)",
    provider: "cloudflare",
    model: "@cf/openai/gpt-oss-120b",
    note: "Optional reasoning model; select explicitly to compare grounded research.",
    manualOnly: true,
  },
];

/**
 * Look up a catalog entry by public id. Accepts the bare id, the `keryx:`-prefixed form used on
 * the OpenAI-compatible surface, and any retired id (mapped to its replacement). Unknown → null
 * (caller uses the default).
 */
export function findModelChoice(id?: string | null): ModelChoice | null {
  if (!id) return null;
  const bare = id.trim().replace(/^keryx:/, "");
  const resolved = RETIRED_IDS[bare] ?? bare;
  return MODEL_CATALOG.find((m) => m.id === resolved) ?? null;
}
