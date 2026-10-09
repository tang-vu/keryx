import { describe, expect, it } from "vitest";
import {
  API_KEY_SCOPES,
  LEGACY_API_KEY_SCOPES,
  hasScope,
  normalizeScopes,
  normalizeSourceIds,
  parseScopes,
  parseSourceIds,
  restrictToKeySources,
  serializeScopes,
  serializeSourceIds,
} from "./api-key-scopes";

describe("normalizeScopes", () => {
  it("keeps only known scopes", () => {
    expect(normalizeScopes(["ask", "drop-database"])).toEqual(["ask"]);
  });

  it("grants everything when nothing usable was asked for", () => {
    // A key that can do nothing is a support ticket, not a security win.
    expect(normalizeScopes(undefined)).toEqual([...LEGACY_API_KEY_SCOPES]);
    expect(normalizeScopes([])).toEqual([...LEGACY_API_KEY_SCOPES]);
    expect(normalizeScopes(["nonsense"])).toEqual([...LEGACY_API_KEY_SCOPES]);
    expect(normalizeScopes("ask")).toEqual([...LEGACY_API_KEY_SCOPES]);
  });

  it("returns scopes in declared order, not request order", () => {
    expect(normalizeScopes(["export", "ask"])).toEqual(["ask", "export"]);
  });
});

describe("parseScopes", () => {
  it("reads a pre-scopes key as full power", () => {
    expect(parseScopes(null)).toEqual([...LEGACY_API_KEY_SCOPES]);
    expect(parseScopes("")).toEqual([...LEGACY_API_KEY_SCOPES]);
  });

  it("round-trips a narrowed key", () => {
    expect(parseScopes(serializeScopes(["export"]))).toEqual(["export"]);
  });

  it("survives whitespace and unknown entries in stored data", () => {
    expect(parseScopes(" export , retired-scope ")).toEqual(["export"]);
  });

  it("falls back to full power rather than locking out a corrupted row", () => {
    expect(parseScopes("retired-scope")).toEqual([...LEGACY_API_KEY_SCOPES]);
  });
});

describe("explicit private profile scopes", () => {
  it("declares new scopes but never adds them to historical implicit keys", () => {
    expect(API_KEY_SCOPES).toContain("profile:read"); expect(API_KEY_SCOPES).toContain("profile:write");
    for (const stored of [null, "", "retired-scope", "ask,export"]) {
      expect(hasScope(parseScopes(stored), "profile:read")).toBe(false);
      expect(hasScope(parseScopes(stored), "profile:write")).toBe(false);
    }
    expect(normalizeScopes(["profile:read"])).toEqual(["profile:read"]);
    expect(parseScopes(serializeScopes(["profile:write"]))).toEqual(["profile:write"]);
  });
});
describe("explicit delegated operator read scope", () => {
  it("keeps historical/profile/history keys unprivileged and supports deliberate read-only selection", () => {
    for (const stored of [null, "", "unknown", "ask,export", "profile:read,history:read"]) expect(hasScope(parseScopes(stored), "operator:read")).toBe(false);
    expect(normalizeScopes(["operator:read"])).toEqual(["operator:read"]);
    expect(parseScopes(serializeScopes(["operator:read"]))).toEqual(["operator:read"]);
  });
});

describe("hasScope", () => {
  it("gates a narrowed key", () => {
    expect(hasScope(["export"], "export")).toBe(true);
    expect(hasScope(["export"], "ask")).toBe(false);
  });

  it("treats a session (no key, no scopes) as unscoped", () => {
    expect(hasScope(undefined, "ask")).toBe(true);
    expect(hasScope(undefined, "export")).toBe(true);
  });
});

describe("source pinning", () => {
  it("defaults to every owned source", () => {
    expect(normalizeSourceIds(undefined)).toBeNull();
    expect(normalizeSourceIds([])).toBeNull();
    expect(serializeSourceIds(null)).toBeNull();
  });

  it("dedupes, trims and drops ids that would break the stored encoding", () => {
    // "b,c" is dropped whole, never split into two pins: narrowing further than asked is safe,
    // silently granting a source nobody named is not. Real ids are slugs or 0x hashes.
    expect(normalizeSourceIds([" a ", "a", "b,c", "", 42])).toEqual(["a"]);
  });

  it("round-trips through storage", () => {
    expect(parseSourceIds(serializeSourceIds(["a", "b"]))).toEqual(["a", "b"]);
    expect(parseSourceIds(null)).toBeNull();
  });
});

describe("restrictToKeySources", () => {
  const owned = [{ id: "a" }, { id: "b" }];

  it("narrows to the pinned ids", () => {
    expect(restrictToKeySources(owned, ["b"])).toEqual([{ id: "b" }]);
  });

  it("cannot add a source the wallet does not own", () => {
    // The pin names a stranger's source; ownership was decided before this ran.
    expect(restrictToKeySources(owned, ["someone-elses"])).toEqual([]);
  });

  it("passes everything through when unpinned", () => {
    expect(restrictToKeySources(owned, null)).toEqual(owned);
    expect(restrictToKeySources(owned, undefined)).toEqual(owned);
  });
});
