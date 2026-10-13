/** Ordinary finalizers enclose verbatim topics/excerpts in curly quotes. Their
 * language is outside generated-prose provenance. Preserve bytes and use the
 * widest span so nested quotes cannot accidentally acquire the prose tag. */
export function quotedOriginalSpan(text: string): { start: number; end: number } | undefined {
  const start = text.indexOf("“");
  if (start < 0) return undefined;
  const close = text.lastIndexOf("”");
  const end = close > start ? close + 1 : text.length;
  return { start, end };
}

export function quotedOriginalParts(text: string): Array<{ text: string; original: boolean }> {
  const span = quotedOriginalSpan(text);
  if (!span) return [{ text, original: false }];
  const { start, end } = span;
  return [{ text: text.slice(0, start), original: false }, { text: text.slice(start, end), original: true },
    { text: text.slice(end), original: false }].filter(part => part.text !== "");
}
