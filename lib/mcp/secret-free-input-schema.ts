import { z } from "zod";

/** Retain the established Zod3 discovery/validation contract while preventing
 * SDK errors from echoing private caller fields. Invalid values never default.
 */
export function secretFreeMcpInput<T extends z.ZodRawShape>(shape: T, refusal: string) {
  const guarded = Object.fromEntries(Object.entries(shape).map(([name, schema]) => {
    const field = schema.catch(() => { throw new Error(refusal); });
    field.isOptional = () => schema.isOptional();
    return [name, field];
  }));
  return z.object(guarded).strict(refusal);
}
