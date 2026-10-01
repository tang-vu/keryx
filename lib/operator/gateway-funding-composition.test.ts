import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import ts from "typescript";
import { createOperatorGatewayFundingComposition, OPERATOR_GATEWAY_FUNDING_ACTIVATION } from "./gateway-funding-composition";

function runtimeImports(source: string, file: string): string[] {
  const imports: string[] = [];
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typesOnly = clause?.isTypeOnly || (!clause?.name && named && ts.isNamedImports(named)
        && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly));
      if (!typesOnly) imports.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.exportClause;
      if (!node.isTypeOnly && !(named && ts.isNamedExports(named) && named.elements.length > 0
        && named.elements.every(element => element.isTypeOnly))) imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteralLike(argument)) throw new Error(`Unreviewed dynamic import: ${file}`);
      imports.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return imports;
}

const dormantRuntime = /(?:^|\/)(?:gateway-funding-[^/]+|enrolled-sqlite-adapter|enrolled-supabase-adapter|enrolled-sqlite-schema-profile|runtime-storage-config|storage-identity-(?:connection|sqlite|provision))\.(?:ts|tsx|mts)$/;

function assertDormantGraph(roots: string[], read: (file: string) => string,
  resolveImport: (file: string, specifier: string) => string | null): Set<string> {
  const visited = new Set<string>();
  const walk = (file: string, chain: string[]) => {
    if (dormantRuntime.test(file)) throw new Error(`Dormant runtime reachable: ${[...chain, file].join(" -> ")}`);
    if (visited.has(file)) return;
    visited.add(file);
    for (const specifier of runtimeImports(read(file), file)) {
      const dependency = resolveImport(file, specifier);
      if (dependency) walk(dependency, [...chain, file]);
    }
  };
  for (const file of roots) walk(file, []);
  return visited;
}

describe("dormant Operator funding release", () => {
  it("refuses supplied authority, environment opt-in and key loading", async () => {
    const loadKeys = vi.fn(() => { throw new Error("keys must remain unloaded"); });
    const request = Object.defineProperty({ loadKeys, enabled: true, reviewedBinding: {} }, "identity", {
      get() { throw new Error("untrusted binding must remain unread"); },
    });
    vi.stubEnv("KERYX_OPERATOR_FUNDING_ENABLED", "1");
    try {
      expect(OPERATOR_GATEWAY_FUNDING_ACTIVATION.state).toBe("disabled");
      await expect(createOperatorGatewayFundingComposition(request)).rejects.toThrow("reviewed enrollment and cutover required");
      expect(loadKeys).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("keeps funding, enrollment and closed factory selection unreachable from application entrypoints", () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? files(path) : /\.(?:ts|tsx|mts)$/.test(entry.name) ? [path] : [];
    });
    const cwd = process.cwd();
    const name = (file: string) => relative(cwd, file).replaceAll("\\", "/");
    const roots = files(join(cwd, "app")).filter(file => !/(?:\.test\.|-fixture\.)/.test(file)).map(name);
    const resolveImport = (file: string, specifier: string) => {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
      const base = specifier.startsWith("@/") ? join(cwd, specifier.slice(2)) : resolve(cwd, dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts"), join(base, "index.tsx")]
        .find(candidate => existsSync(candidate) && /\.(?:ts|tsx|mts)$/.test(candidate));
      if (!target && !existsSync(base)) throw new Error(`Unresolved application import: ${file}: ${specifier}`);
      return target ? name(target) : null;
    };
    const visited = assertDormantGraph(roots, file => readFileSync(join(cwd, file), "utf8"), resolveImport);
    const closedModules = new Set(["lib/db/enrolled-sqlite-adapter.ts", "lib/db/enrolled-supabase-adapter.ts", "lib/db/enrolled-sqlite-schema-profile.ts"]);
    for (const file of [...files(join(cwd, "lib")), ...files(join(cwd, "scripts"))]) {
      const importer = name(file);
      if (/(?:\.test\.|-fixture\.|\/fixtures\/|^scripts\/test-)/.test(importer)) continue;
      for (const specifier of runtimeImports(readFileSync(file, "utf8"), importer)) {
        const target = resolveImport(importer, specifier);
        if (!target || !closedModules.has(target)) continue;
        // The closed factory may construct its fixed reference profile; no ordinary consumer may select either.
        expect([importer, target]).toEqual(["lib/db/enrolled-sqlite-adapter.ts", "lib/db/enrolled-sqlite-schema-profile.ts"]);
      }
    }
    // These shared bridges carry immutable identity/AAD data, not factory or enrollment selection.
    expect(visited.has("lib/db/sqlite-adapter.ts")).toBe(true);
    expect(visited.has("lib/sources/enrolled-content-cache.ts")).toBe(true);
    expect(visited.has("lib/db/storage-identity.ts")).toBe(true);
    const composition = readFileSync(join(process.cwd(), "lib/operator/gateway-funding-composition.ts"), "utf8");
    expect(composition).not.toMatch(/\bimport\s*\(/);
  });

  it.each(["import './helper';", "void import('./helper');"])("rejects indirect dormant selection through an ordinary helper: %s", edge => {
    const sources: Record<string, string> = {
      "app/entry.ts": edge,
      "app/helper.ts": "export { createEnrolledSqliteAdapter } from '../lib/db/enrolled-sqlite-adapter';",
      "lib/db/enrolled-sqlite-adapter.ts": "",
    };
    expect(() => assertDormantGraph(["app/entry.ts"], file => sources[file], (file, specifier) =>
      posix.resolve("/", posix.dirname(file), specifier).slice(1) + ".ts")).toThrow("Dormant runtime reachable");
    expect(runtimeImports("import type { Authority } from './helper'; type Other = import('./helper').Authority;", "types.ts")).toEqual([]);
  });

  it.each(["export { createEnrolledSupabaseAdapter } from '../lib/db/enrolled-supabase-adapter';",
    "void import('../lib/db/enrolled-supabase-adapter');",
    "export { readRuntimeStorageDeployment } from '../lib/db/runtime-storage-config';"])(
    "rejects transitive PostgreSQL factory or manifest selection: %s", edge => {
      const sources: Record<string, string> = {
        "app/entry.ts": "import './helper';",
        "app/helper.ts": edge,
      };
      expect(() => assertDormantGraph(["app/entry.ts"], file => sources[file], (file, specifier) =>
        posix.resolve("/", posix.dirname(file), specifier).slice(1) + ".ts"))
        .toThrow("Dormant runtime reachable");
    });

  it("permits only descriptive PostgreSQL type and pure-core bridges in the application graph", () => {
    const sources: Record<string, string> = {
      "app/entry.ts": "import './helper';",
      "app/helper.ts": "import type { Authority } from '../lib/db/enrolled-supabase-adapter'; export { SupabaseAdapter } from '../lib/db/supabase-adapter';",
      "lib/db/supabase-adapter.ts": "import type { StorageDeploymentManifest } from './runtime-storage-config'; export { canonicalJson } from '../canonical-json';",
      "lib/canonical-json.ts": "export const canonicalJson = JSON.stringify;",
    };
    const visited = assertDormantGraph(["app/entry.ts"], file => sources[file], (file, specifier) =>
      posix.resolve("/", posix.dirname(file), specifier).slice(1) + ".ts");
    expect([...visited]).toEqual(["app/entry.ts", "app/helper.ts", "lib/db/supabase-adapter.ts", "lib/canonical-json.ts"]);
  });
});
