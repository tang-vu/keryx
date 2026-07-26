/**
 * Which credential and host serves each catalog provider — the one place that knows.
 *
 * The catalog is pure data so the browser picker can import it; this is the half that needs
 * `config`, kept apart for that reason. It exists because the answer was previously written out
 * three times (the picker's availability filter, the engine builder, the hourly watchdog), each
 * with DeepSeek's key and host inlined. A second provider would have had to be added to all three,
 * and the one that got missed would have failed the way this codebase least wants: quietly, by
 * falling back to a working model while every log kept naming the one the asker picked.
 *
 * Returning null for an unconfigured provider is what keeps the picker honest — a model the box has
 * no credential for is never offered, rather than offered and silently degraded.
 */

import { config } from "../config";
import type { ModelProvider } from "./model-catalog";

export interface ProviderEndpoint {
  baseUrl: string;
  apiKey: string;
}

/** Credentials for a provider, or null when this box cannot reach it. */
export function endpointFor(provider: ModelProvider): ProviderEndpoint | null {
  const endpoints: Record<ModelProvider, ProviderEndpoint> = {
    deepseek: { baseUrl: config.llmBaseUrl, apiKey: config.deepseekKey },
    mimo: { baseUrl: config.mimoBaseUrl, apiKey: config.mimoKey },
  };
  const endpoint = endpoints[provider];
  return endpoint?.apiKey ? endpoint : null;
}
