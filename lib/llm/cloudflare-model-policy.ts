/** Conservative prompt-byte + output-token ceilings, with framing headroom.
 * These are admission bounds, not tokenization or research-quality guarantees. */
export function cloudflareModelPolicy(model: string) {
  if (model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast") {
    return { maximumCombinedUnits: 23_000, maximumOutputTokens: 8192 } as const;
  }
  if (model === "@cf/openai/gpt-oss-120b") {
    return { maximumCombinedUnits: 120_000, maximumOutputTokens: 8192, reasoningEffort: "low" } as const;
  }
  throw new Error("Cloudflare reasoning model policy unavailable");
}
