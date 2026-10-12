import { z } from "zod";
import { canonicalJson } from "../canonical-json";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0{40}$/i.test(value)).transform(value => value.toLowerCase() as `0x${string}`);
export const sourceRegistryAuthoritySchema = z.object({
  network: z.enum(["eip155:5042", "eip155:5042002"]), address,
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase() as `0x${string}`),
  deployBlock: z.string().regex(/^(0|[1-9]\d{0,19})$/),
}).strict();
export type SourceRegistryAuthority = z.infer<typeof sourceRegistryAuthoritySchema>;
export function sameRegistryAuthority(left: SourceRegistryAuthority, right: SourceRegistryAuthority): boolean {
  return canonicalJson(sourceRegistryAuthoritySchema.parse(left)) === canonicalJson(sourceRegistryAuthoritySchema.parse(right));
}
