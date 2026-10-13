/** Literal field comparison, independent of JSON object property order. */
export function zoteroDataEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => zoteroDataEqual(value, right[index]));
  if (left && right && typeof left === "object" && typeof right === "object") {
    const a = Object.keys(left).sort(), b = Object.keys(right).sort();
    return zoteroDataEqual(a, b) && a.every(key => zoteroDataEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
  }
  return left === right;
}

/** Provider-assigned versions can change; every submitted content field must
 * survive. Collection membership is a set, while creator order is significant. */
export function zoteroSubmittedFieldsMatch(data: Record<string, unknown>, submitted: Record<string, unknown>): boolean {
  return Object.entries(submitted).every(([field, value]) => {
    if (field === "version") return true;
    if (field === "collections" && Array.isArray(value) && Array.isArray(data[field]))
      return zoteroDataEqual([...value].sort(), [...data[field]].sort());
    return zoteroDataEqual(data[field], value);
  });
}
