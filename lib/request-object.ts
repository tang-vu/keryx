/** JSON request shapes must be checked before typed field access or research admission. */
export function isRequestObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
