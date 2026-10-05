import { describe, expect, it } from "vitest";
import { publisherControlLabel, safePublisherUrl } from "./source-display";
import type { RegistryEntry } from "./source-directory";

describe("public source display authority", () => {
  it("never turns a grandfathered eligibility flag into verified publisher proof", () => {
    const entry = { source: { verified: true }, claim: null, claimPolicyUnavailable: false, controlFresh: false } as RegistryEntry;
    expect(publisherControlLabel(entry)).toBe("Current publisher proof not shown");
    expect(publisherControlLabel({ ...entry, claimPolicyUnavailable: true })).toBe("Publisher control unavailable");
    expect(publisherControlLabel({ ...entry, claim: {} as RegistryEntry["claim"] })).toBe("Publisher control expired");
    expect(publisherControlLabel({ ...entry, claim: {} as RegistryEntry["claim"], controlFresh: true })).toBe("Publisher control verified");
  });
  it("keeps unverified listings navigable without allowing arbitrary external schemes", () => {
    expect(safePublisherUrl("https://publisher.example/article")).toBe("https://publisher.example/article");
    expect(safePublisherUrl("http://publisher.example/")).toBe("http://publisher.example/");
    for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///private", "https://user:password@publisher.example", "not a URL"]) expect(safePublisherUrl(url)).toBeNull();
  });
});
