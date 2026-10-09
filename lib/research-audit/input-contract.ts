/** Shared runtime bounds for offline JSON and future adapter inputs. No coercion or asserted authority. */
export const MAX_AUDIT_ROWS = 2000;
export function auditObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid audit object");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error("Invalid audit prototype");
  if (Reflect.ownKeys(value).some(key => typeof key !== "string")
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => !("value" in field))) throw new Error("Invalid audit property");
}
export function auditString(value: unknown, optional = false): asserts value is string | undefined {
  if (optional && value === undefined) return;
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid audit identifier");
}
export function auditArray(value: unknown, maximum = MAX_AUDIT_ROWS): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("Invalid audit collection");
}
export function auditWeight(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid audit weight");
}
export function auditWallet(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error("Invalid audit wallet");
}
