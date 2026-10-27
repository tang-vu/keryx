import type { HtmlTextLayout, TextRegion } from "../web-research/html-text-layout";

const MAX_SAMPLES = 4;
const SAMPLES_PER_SECTION = 2;
const label = (text: string) => text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

/** Small structural sample, never a translation or a relevance/coverage judgment.
 * The caller supplies an observed, complete role map and already-scanned blocks.
 * Only intact body blocks qualify; preformatted/enumerated bundles retain their
 * existing context path. No fetched bytes or evidence authority are added.
 */
export function structuralContextSamples(text: string, blocks: readonly TextRegion[], layout: HtmlTextLayout,
  maximumBlockCharacters: number, enumerations?: ReadonlyMap<number, TextRegion>): TextRegion[] {
  if (layout.limited) return [];
  const headings = layout.headings;
  const lastHeading = new Map(headings.map(heading => [label(text.slice(heading.start, heading.end)), heading.start]));
  const firstLink = new Map<number, string>();
  const navigation = new Set<number>();
  let section = -1;
  for (const block of blocks) {
    while (headings[section + 1] && headings[section + 1]!.end <= block.start) section++;
    const name = label(text.slice(block.start, block.end));
    // Two distinct copies of later observed heading labels identify a navigation
    // sample. They do not prove an HTML anchor or a semantic section boundary.
    if ((lastHeading.get(name) ?? -1) <= block.end) continue;
    const first = firstLink.get(section);
    if (first && first !== name) navigation.add(section);
    else firstLink.set(section, name);
  }
  const counts = new Map<number, number>();
  const samples: TextRegion[] = [];
  section = -1;
  for (const block of blocks) {
    while (headings[section + 1] && headings[section + 1]!.end <= block.start) section++;
    const next = headings[section + 1];
    if (section < 0 || navigation.has(section) || (counts.get(section) ?? 0) >= SAMPLES_PER_SECTION ||
      block.end - block.start > maximumBlockCharacters || next && next.start < block.end) continue;
    const body = label(text.slice(block.start, block.end));
    if (!body || lastHeading.has(body) || enumerations?.has(block.start) ||
      layout.preformatted.some(region => region.start < block.end && region.end > block.start)) continue;
    samples.push(block);
    counts.set(section, (counts.get(section) ?? 0) + 1);
    if (samples.length === MAX_SAMPLES) break;
  }
  return samples;
}
