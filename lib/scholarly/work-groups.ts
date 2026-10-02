import type { GatheredContent } from "../llm";
import { publisherGroup } from "../web-research/url-identity";
import { normalizeDoi } from "./doi";

/** Known shared work identity can only reduce domain-group diversity, never raise it. */
export function scholarlyWorkGroups(sources: readonly GatheredContent[], cited: ReadonlySet<string>): Map<string, string> {
  const parents = new Map<string, string>(), markerDomains = new Map<string, string>(), doiDomains = new Map<string, string>();
  function root(group: string): string {
    const next = parents.get(group);
    if (!next || next === group) return group;
    const found = root(next); parents.set(group, found); return found;
  }
  for (const source of sources) {
    if (!cited.has(source.marker)) continue;
    const group = source.itemUrl ? publisherGroup(source.itemUrl) : "";
    if (!group) continue;
    if (!parents.has(group)) parents.set(group, group);
    markerDomains.set(source.marker, group);
    // Discovery metadata and absent/malformed DOI cannot manufacture a shared-work link.
    const doi = source.scholarly?.evidenceScope ? normalizeDoi(source.scholarly.doi ?? "") : undefined;
    if (!doi) continue;
    const other = doiDomains.get(doi);
    if (!other) { doiDomains.set(doi, group); continue; }
    const left = root(group), right = root(other);
    // Deterministic representative makes admission independent of source order.
    parents.set(left < right ? right : left, left < right ? left : right);
  }
  return new Map([...markerDomains].map(([marker, group]) => [marker, root(group)]));
}
