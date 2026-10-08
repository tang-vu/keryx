import { sha256, stringToHex } from "viem";

export interface TextRegion { start: number; end: number }
/** Observed roles in the extracted text, never a certificate of semantic coverage. */
export interface HtmlTextLayout {
  format: "keryx-html-text-layout-v1";
  textCharacters: number;
  textSha256: string;
  limited: boolean;
  preformatted: readonly TextRegion[];
  headings: readonly TextRegion[];
}
const observed = new WeakSet<HtmlTextLayout>();

/** Recheck at consumption too: a copied layout must not survive a changed body.
 * Browser-safe hashing keeps quote validation independent of Node-only extraction.
 */
export function validHtmlTextLayout(text: string, value: unknown): value is HtmlTextLayout {
  if (!value || typeof value !== "object" || text.length > 60000) return false;
  const layout = value as HtmlTextLayout;
  if (layout.format !== "keryx-html-text-layout-v1" || typeof layout.limited !== "boolean" || layout.textCharacters !== text.length ||
      !/^[a-f0-9]{64}$/u.test(layout.textSha256) ||
      !Array.isArray(layout.preformatted) || !Array.isArray(layout.headings) ||
      layout.preformatted.length + layout.headings.length > 512) return false;
  for (const regions of [layout.preformatted, layout.headings]) {
    let previousEnd = 0;
    for (const region of regions) {
      if (!region || !Number.isSafeInteger(region.start) || !Number.isSafeInteger(region.end) ||
          region.start < previousEnd || region.end <= region.start || region.end > text.length ||
          /[\uDC00-\uDFFF]/u.test(text[region.start] ?? "") ||
          /[\uD800-\uDBFF]/u.test(text[region.end - 1] ?? "")) return false;
      previousEnd = region.end;
    }
  }
  return sha256(stringToHex(text)).slice(2) === layout.textSha256;
}

/** Called only at the isolated parser's validated output boundary. JSON copies
 * cannot enroll themselves; historical source records keep their prior behavior.
 */
export function observeHtmlTextLayout(text: string, value: unknown): HtmlTextLayout {
  if (!validHtmlTextLayout(text, value)) throw new Error("Invalid HTML text layout");
  const clone = Object.freeze({ format: value.format, textCharacters: value.textCharacters, textSha256: value.textSha256, limited: value.limited,
    preformatted: Object.freeze(value.preformatted.map(region => Object.freeze({ start: region.start, end: region.end }))),
    headings: Object.freeze(value.headings.map(region => Object.freeze({ start: region.start, end: region.end }))) });
  observed.add(clone);
  return clone;
}

export function observedHtmlTextLayout(text: string, value: HtmlTextLayout | undefined): HtmlTextLayout | undefined {
  return value && observed.has(value) && validHtmlTextLayout(text, value) ? value : undefined;
}
