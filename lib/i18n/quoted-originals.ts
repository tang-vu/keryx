/** Ordinary finalizers enclose verbatim topics/excerpts in curly quotes. Their
 * language is outside generated-prose provenance. Preserve bytes and use the
 * widest span so nested quotes cannot accidentally acquire the prose tag. */
export function quotedOriginalParts(text: string): Array<{ text: string; original: boolean }> {
  const start = text.indexOf("“");
  if (start < 0) return [{ text, original: false }];
  const close = text.lastIndexOf("”");
  const end = close > start ? close + 1 : text.length;
  return [{ text: text.slice(0, start), original: false }, { text: text.slice(start, end), original: true },
    { text: text.slice(end), original: false }].filter(part => part.text !== "");
}
