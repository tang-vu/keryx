import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SUPABASE_ENROLLED_METHODS } from "./supabase-enrolled-methods";

describe("enrolled Supabase reviewed surface", () => {
  it("accounts for every implemented public method including startup and iteration", () => {
    const source = ts.createSourceFile("supabase-adapter.ts",
      readFileSync(new URL("./supabase-adapter.ts", import.meta.url), "utf8"),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const adapter = source.statements.find((node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === "SupabaseAdapter");
    expect(adapter).toBeDefined();
    const methods = adapter!.members.filter((node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) && !ts.isPrivateIdentifier(node.name) &&
      !node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword));
    const names = methods.map((node) => node.name.getText(source));
    expect(names.sort()).toEqual(Object.keys(SUPABASE_ENROLLED_METHODS).sort());
    expect(new Set(names).size).toBe(names.length);
    expect(SUPABASE_ENROLLED_METHODS.init).toBe("read");
    expect(SUPABASE_ENROLLED_METHODS.iterateRecentQueries).toBe("read");
  });

  it("keeps last-use authentication and authority-bearing calls in the literal write inventory", () => {
    for (const name of ["verifyApiKey", "recordPayment", "setCached", "admitBrowserSourceSigningOriginal",
      "signBrowserSigningOriginal", "admitBrowserQueryPolicy"] as const) {
      expect(SUPABASE_ENROLLED_METHODS[name]).toBe("write");
    }
  });

  it("explicitly refuses Monthly and shared purchase admission until a separate enrolled domain cutover", () => {
    for (const method of ["claimResearchPurchase", "createResearchMonthly", "getResearchMonthly", "redeemResearchMonthly"] as const)
      expect(SUPABASE_ENROLLED_METHODS[method]).toBe("unsupported");
  });

  it("registers every installation-generated domain wrapper with its exact read/write mode", () => {
    const wrappers = readFileSync(new URL("../../supabase/migrations/0075_enrolled_storage_domain_wrappers.sql", import.meta.url), "utf8");
    const cutover = readFileSync(new URL("../../supabase/migrations/0076_enrolled_storage_owner_cutover.sql", import.meta.url), "utf8");
    const list = (name: string) => {
      const body = wrappers.match(new RegExp(`\\b${name} text\\[\\] := array\\[([\\s\\S]*?)\\];`))?.[1];
      expect(body).toBeDefined();
      return [...body!.matchAll(/'([a-z][a-z0-9_]+)'/g)].map((match) => match[1]);
    };
    const names = list("names"), readonly = new Set(list("readonly_names"));
    const entries = [...cutover.matchAll(/^  \('([a-z][a-z0-9_]+)',array\[(.*?)\]::text\[\],(true|false),(true|false)\)[,;]/gm)];
    expect(names).toHaveLength(54);
    expect(new Set(entries.map((entry) => entry[1])).size).toBe(entries.length);
    for (const name of names) {
      const entry = entries.find((item) => item[1] === name);
      expect(entry, `missing operation ${name}`).toBeDefined();
      expect(entry![4] === "true", `mode ${name}`).toBe(readonly.has(name));
      expect(entry![2]).toMatch(/^'[a-z][a-z0-9_]*'(?:,'[a-z][a-z0-9_]*')*$/);
    }
  });
});
