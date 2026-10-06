/** Normalize DOI syntax only. Resolution still requires an observed registry response. */
export function normalizeDoi(raw: string): string | undefined {
  let value = raw.trim().replace(/^doi:\s*/i, "");
  if (/^https:\/\/(?:dx\.)?doi\.org\//i.test(value)) {
    try { const url = new URL(value); if (url.username || url.password || url.search || url.hash) return;
      value = decodeURIComponent(url.pathname.slice(1)); } catch { return; }
  }
  if (value.length > 200 || !/^10\.\d{4,9}\/[^\s\u0000-\u001f\u007f?#]+$/i.test(value)) return;
  return value.toLowerCase();
}

export function questionDois(question: string, maxResults = 2): string[] {
  // Prose punctuation is ambiguous; exact standalone DOI input preserves it.
  const exact = normalizeDoi(question);
  if (exact) return [exact];
  return [...new Set((question.match(/https:\/\/(?:dx\.)?doi\.org\/10\.\d{4,9}\/[^\s<>"\u0000-\u001f]+|10\.\d{4,9}\/[^\s<>"\u0000-\u001f]+/gi) ?? [])
    .map(value => {
      value = value.replace(/[.,;:!?]+$/, "");
      while (value.endsWith(")") && (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)) value = value.slice(0, -1);
      return normalizeDoi(value);
    })
    .filter((value): value is string => !!value))].slice(0, maxResults);
}

export const doiUrl = (doi: string) => `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;
