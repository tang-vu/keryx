import { isWellFormedUtf16 } from "../llm/well-formed-utf16";

/** Bound traversal before serialization/Zod. Only plain JSON data is portable;
 * getters, toJSON hooks, cycles and oversized/deep structures are never evaluated. */
export function boundedPortableCopy(value: unknown, maximumBytes = 98304): unknown {
  const chunks: string[] = [], ancestors = new Set<object>(), encoder = new TextEncoder();
  let bytes = 0, entries = 0;
  const append = (text: string) => {
    if (text.length > maximumBytes || (bytes += encoder.encode(text).length) > maximumBytes) throw new Error();
    chunks.push(text);
  };
  const visit = (item: unknown, depth: number): void => {
    if (++entries > 8192 || depth > 16) throw new Error();
    if (item === null || typeof item === "boolean") { append(JSON.stringify(item)); return; }
    if (typeof item === "number" && Number.isFinite(item)) { append(JSON.stringify(item)); return; }
    if (typeof item === "string") {
      if (item.length > maximumBytes || !isWellFormedUtf16(item)) throw new Error();
      append(JSON.stringify(item)); return;
    }
    if (!item || typeof item !== "object" || ancestors.has(item)) throw new Error();
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (item.length > 512 || Object.keys(item).length !== item.length) throw new Error();
      append("[");
      for (let index = 0; index < item.length; index++) {
        const property = Object.getOwnPropertyDescriptor(item, String(index));
        if (!property || !("value" in property)) throw new Error();
        if (index) append(","); visit(property.value, depth + 1);
      }
      append("]");
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error();
      const keys = Reflect.ownKeys(item);
      if (keys.length > 64 || keys.some(key => typeof key !== "string")) throw new Error();
      append("{"); let separator = false;
      for (const key of keys as string[]) {
        if (key.length > 4096 || !isWellFormedUtf16(key)) throw new Error();
        const property = Object.getOwnPropertyDescriptor(item, key)!;
        if (!("value" in property)) throw new Error();
        if (!property.enumerable || property.value === undefined) continue;
        if (separator) append(","); separator = true;
        append(JSON.stringify(key)); append(":"); visit(property.value, depth + 1);
      }
      append("}");
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  return JSON.parse(chunks.join(""));
}

