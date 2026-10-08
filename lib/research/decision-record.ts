import type { Decision } from "../types";

function unitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Display-shape validation only; a trace record grants no read or payment authority. */
export function isDecisionRecord(value: unknown): value is Decision {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !("value" in descriptor))) return false;
    const row = value as Record<string, unknown>;
    return !("protocol" in row) && typeof row.sourceId === "string" && row.sourceId.length > 0 &&
      typeof row.sourceName === "string" && typeof row.rationale === "string" &&
      (row.action === "BUY" || row.action === "SKIP" || row.action === "CACHE") &&
      unitInterval(row.expectedValue) && unitInterval(row.confidence) &&
      typeof row.price === "number" && Number.isFinite(row.price) && row.price >= 0 &&
      Array.isArray(row.targets) && row.targets.every(target => Number.isSafeInteger(target) && target >= 0) &&
      (row.external === undefined || typeof row.external === "boolean");
  } catch { return false; }
}
