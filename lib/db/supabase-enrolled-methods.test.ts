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
});
