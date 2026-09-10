import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/);
/** Pure portable disclosure. No credentials, defaults or mutable catalog lookup in verification. */
export const privateReasoningPolicySchema = z.object({
  modelId: identifier, provider: z.enum(["deepseek", "mimo"]), wireModel: identifier,
  endpoint: z.string().url().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
        && url.href === value && url.pathname.endsWith("/chat/completions");
    } catch { return false; }
  }),
  fallback: z.literal("local-heuristic"), redirects: z.literal("prohibited"),
}).strict();
export type PrivateReasoningPolicy = z.infer<typeof privateReasoningPolicySchema>;
export function privateReasoningPolicyInput(value: unknown) {
  return JSON.stringify(privateReasoningPolicySchema.parse(value));
}
