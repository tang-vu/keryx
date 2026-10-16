
export type UiPreview = Readonly<Record<string, Readonly<Record<string, string>>>>;
export const emptyUiPreview: UiPreview = Object.freeze({});


export function previewText(preview: UiPreview, source: string, namespaces?: readonly string[]): string {
  const matches = (namespaces ?? Object.keys(preview).filter(name => !name.startsWith("$"))).flatMap(namespace => {
    const entries = Object.hasOwn(preview, namespace) ? preview[namespace] : undefined;
    return entries && Object.hasOwn(entries, source) ? [entries[source]] : [];
  });
  return matches.length && matches.every(text => text === matches[0]) ? matches[0] : source;
}

export function previewMessage(preview: UiPreview, key: string, source: string): string {
  return Object.hasOwn(preview.$messages ?? {}, key) ? preview.$messages[key] : source;
}

/** Translate authored catalogue objects only, leaving identifiers and absent leaves exact. */
export function previewCopy<T>(preview: UiPreview, namespace: string, copy: T): T {
  if (typeof copy === "string") return previewText(preview, copy, [namespace]) as T;
  if (Array.isArray(copy)) return copy.map(value => previewCopy(preview, namespace, value)) as T;
  if (copy && typeof copy === "object") return Object.fromEntries(Object.entries(copy).map(([key, value]) =>
    [key, previewCopy(preview, namespace, value)])) as T;
  return copy;
}
