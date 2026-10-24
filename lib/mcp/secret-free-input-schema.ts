import { z } from "zod";

/** Preserve discovery and runtime bounds while SDK validation errors contain no
 * caller token/value. Current fields forbid null. An unreachable literal catch
 * sentinel is always rejected; unlike dynamic catches it has a JSON Schema.
 */
export function secretFreeMcpInput<T extends Record<string, z.ZodType>>(shape: T, refusal: string) {
  const guarded = Object.fromEntries(Object.entries(shape).map(([name, schema]) => {
    if (schema.safeParse(null).success) throw new Error(refusal);
    const original = z.toJSONSchema(schema, { target: "draft-7", io: "input" });
    const field = schema.catch(null as never).refine(value => value !== null, refusal).meta({ default: original.default });
    return [name, schema.isOptional() ? field : field.nonoptional()];
  }));
  return z.object(guarded, { error: refusal }).strict();
}
