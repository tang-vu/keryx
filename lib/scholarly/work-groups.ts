import type { GatheredContent } from "../llm";
import { bodyIdentity, publisherGroup } from "../web-research/url-identity";
import { normalizeDoi } from "./doi";

/** Observed publisher/work/body links can only reduce domain-group diversity. */
export function scholarlyWorkGroups(sources: readonly GatheredContent[], cited: ReadonlySet<string>): Map<string, string> {
  const parents = new Map<string, string>(), markerDomains = new Map<string, string>(), doiDomains = new Map<string, string>();
  const publisherDomains = new Map<string, string>();
  const bodyDomains = new Map<string, string>();
  function root(group: string): string {
    const next = parents.get(group);
    if (!next || next === group) return group;
    const found = root(next); parents.set(group, found); return found;
  }
  function union(group: string, other: string): void {
    const left = root(group), right = root(other);
    // Deterministic representative makes admission independent of source order.
    parents.set(left < right ? right : left, left < right ? left : right);
  }
  for (const source of sources) {
    if (!cited.has(source.marker)) continue;
    const group = source.itemUrl ? publisherGroup(source.itemUrl) : "";
    if (!group) continue;
    if (!parents.has(group)) parents.set(group, group);
    markerDomains.set(source.marker, group);
    if (source.sourceId.trim()) {
      const other = publisherDomains.get(source.sourceId);
      if (other) union(group, other);
      else publisherDomains.set(source.sourceId, group);
    }
    // Group copies before mapping markers. Dropping a later copied marker can
    // hide its strong evidence for one target or miss a transitive publisher link.
    // Missing bodies supply no observed shared-content identity.
    if (source.text.trim()) {
      const body = bodyIdentity(source.text), other = bodyDomains.get(body);
      if (other) union(group, other);
      else bodyDomains.set(body, group);
    }
    // Discovery metadata and absent/malformed DOI cannot manufacture a shared-work link.
    const doi = source.scholarly?.evidenceScope ? normalizeDoi(source.scholarly.doi ?? "") : undefined;
    if (!doi) continue;
    const other = doiDomains.get(doi);
    if (!other) { doiDomains.set(doi, group); continue; }
    union(group, other);
  }
  return new Map([...markerDomains].map(([marker, group]) => [marker, root(group)]));
}
