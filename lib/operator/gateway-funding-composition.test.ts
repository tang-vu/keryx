import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import ts from "typescript";
import { createOperatorGatewayFundingComposition, OPERATOR_GATEWAY_FUNDING_ACTIVATION } from "./gateway-funding-composition";

const preparedChild = "scripts/postgres/prepared-next-child.mts";
const preparedHelperRoots = new Map<string, "source" | "metadata.source">([
  ["scripts/immutable-release-public-profile.mjs", "source"],
  ["scripts/immutable-release-staging.mjs", "source"],
  ["scripts/next-public-server.mjs", "metadata.source"],
]);
function namedNodeImport(parsed: ts.SourceFile, module: string, name: string): boolean {
  return parsed.statements.some(statement => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === module
    && !statement.importClause?.isTypeOnly && statement.importClause?.namedBindings
    && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some(element => !element.isTypeOnly
      && !element.propertyName && element.name.text === name));
}
function loaderNamesAreUnshadowed(parsed: ts.SourceFile): boolean {
  let shadowed = false;
  const nameContainsLoader = (name: ts.BindingName): boolean => ts.isIdentifier(name)
    ? name.text === "join" || name.text === "pathToFileURL"
    : name.elements.some(element => !ts.isOmittedExpression(element) && nameContainsLoader(element.name));
  const visit = (node: ts.Node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && nameContainsLoader(node.name)) shadowed = true;
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)
      || ts.isClassExpression(node) || ts.isEnumDeclaration(node)) && node.name && nameContainsLoader(node.name)) shadowed = true;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return !shadowed;
}
/** This Source-owned child checks these exact helper bytes before loading an
 * immutable prepared artifact. Map only its reviewed expression back to the
 * repository source edge; the helper and all descendants are still inspected. */
function preparedArtifactImport(node: ts.CallExpression, parsed: ts.SourceFile, file: string): string | null {
  if (file !== preparedChild || node.expression.kind !== ts.SyntaxKind.ImportKeyword
    || node.arguments.length !== 1 || node.typeArguments?.length) return null;
  const argument = node.arguments[0];
  if (!ts.isPropertyAccessExpression(argument) || argument.questionDotToken || argument.name.text !== "href") return null;
  const url = argument.expression;
  if (!ts.isCallExpression(url) || url.questionDotToken || url.typeArguments?.length
    || !ts.isIdentifier(url.expression) || url.expression.text !== "pathToFileURL" || url.arguments.length !== 1) return null;
  const path = url.arguments[0];
  if (!ts.isCallExpression(path) || path.questionDotToken || path.typeArguments?.length
    || !ts.isIdentifier(path.expression) || path.expression.text !== "join" || path.arguments.length !== 2) return null;
  const [root, helper] = path.arguments;
  if (!ts.isStringLiteral(helper)) return null;
  const expectedRoot = preparedHelperRoots.get(helper.text);
  if (!expectedRoot || !namedNodeImport(parsed, "node:path", "join") || !namedNodeImport(parsed, "node:url", "pathToFileURL")
    || !loaderNamesAreUnshadowed(parsed)) return null;
  const exactRoot = expectedRoot === "source" ? ts.isIdentifier(root) && root.text === "source"
    : ts.isPropertyAccessExpression(root) && !root.questionDotToken && ts.isIdentifier(root.expression)
      && root.expression.text === "metadata" && root.name.text === "source";
  return exactRoot ? "../" + helper.text.slice("scripts/".length) : null;
}

function runtimeImports(source: string, file: string): string[] {
  const imports: string[] = [];
  // Import inspection never reads node.parent; avoid constructing the extra
  // parent links while still visiting every static and dynamic import node.
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
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
      if (argument && ts.isStringLiteralLike(argument)) imports.push(argument.text);
      else {
        const reviewed = preparedArtifactImport(node, parsed, file);
        if (!reviewed) throw new Error(`Unreviewed dynamic import: ${file}`);
        imports.push(reviewed);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return imports;
}

const dormantRuntime = /(?:^|\/)(?:gateway-funding-[^/]+|chat-accounts-sqlite|enrolled-sqlite-adapter|enrolled-supabase-adapter|enrolled-sqlite-schema-profile|runtime-storage-config|storage-identity-(?:connection|sqlite|provision))\.(?:ts|tsx|mts)$/;
const applicationStorageBoundary = "lib/db/application-storage.ts";
const applicationStorageSubstrate = new Set(["lib/db/enrolled-sqlite-adapter.ts", "lib/db/enrolled-supabase-adapter.ts",
  "lib/db/enrolled-sqlite-schema-profile.ts", "lib/db/runtime-storage-config.ts", "lib/db/storage-identity-connection.ts",
  "lib/db/storage-identity-sqlite.ts", "lib/db/chat-accounts-sqlite.ts", "lib/db/gateway-funding-ledger-types.ts", "lib/db/gateway-funding-sqlite-schema.ts"]);
// These exact Node consumers observe the pinned manifest around awaited genuine
// storage admission. Reading configuration grants no factory/enrollment/funding
// authority, and every descendant of this edge is still inspected below.
const manifestObservationReaders = new Set(["lib/payments/mainnet-hosted-gateway.ts", "lib/gateway/unified-balance.ts",
  "lib/operator-obligations/inspection.ts", "lib/sources/registration-sponsor-runtime.ts"]);

function assertDormantGraph(roots: string[], read: (file: string) => string,
  resolveImport: (file: string, specifier: string) => string | null,
  importsFor?: (file: string) => string[]): Set<string> {
  const visited = new Set<string>();
  const walk = (file: string, chain: string[]) => {
    // Only the source-owned APPLICATION boundary admits storage factories. Its entire transitive graph is still inspected:
    // provisioning, funding executor/orchestrator/transaction/key-loading edges remain forbidden.
    const admittedStorage = chain.includes(applicationStorageBoundary) && applicationStorageSubstrate.has(file);
    const watchConnection = chain.at(-1) === "lib/db/topic-watches-sqlite.ts" && file === "lib/db/storage-identity-connection.ts";
    const accountProfile = chain.at(-1) === "lib/accounts/sqlite-store.ts" && file === "lib/db/enrolled-sqlite-schema-profile.ts";
    const manifestObservation = file === "lib/db/runtime-storage-config.ts" && manifestObservationReaders.has(chain.at(-1) ?? "");
    if (file === preparedChild && chain.length > 0
      || dormantRuntime.test(file) && !admittedStorage && !accountProfile && !watchConnection && !manifestObservation) throw new Error(`Dormant runtime reachable: ${[...chain, file].join(" -> ")}`);
    if (visited.has(file)) return;
    visited.add(file);
    for (const specifier of importsFor ? importsFor(file) : runtimeImports(read(file), file)) {
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

  it("permits only the application storage role while keeping funding and enrollment unreachable", () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? files(path) : /\.(?:ts|tsx|mts)$/.test(entry.name) ? [path] : [];
    });
    const cwd = process.cwd();
    const name = (file: string) => relative(cwd, file).replaceAll("\\", "/");
    // Both inspections use the same frozen checkout. Parse each physical source
    // and resolve each physical target once, retaining every role/edge check.
    const parsedImports = new Map<string, string[]>();
    const importsFor = (file: string) => {
      let imports = parsedImports.get(file);
      if (!imports) { imports = runtimeImports(readFileSync(join(cwd, file), "utf8"), file); parsedImports.set(file, imports); }
      return imports;
    };
    const targets = new Map<string, string | null>();
    const roots = files(join(cwd, "app")).filter(file => !/(?:\.test\.|-fixture\.)/.test(file)).map(name);
    const resolveImport = (file: string, specifier: string) => {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
      const base = specifier.startsWith("@/") ? join(cwd, specifier.slice(2)) : resolve(cwd, dirname(file), specifier);
      if (targets.has(base)) return targets.get(base)!;
      // Node ESM .mjs specifiers in TypeScript scripts resolve to their .mts source.
      // Follow that source edge too; ignoring it would omit its authority graph.
      const target = [base, ...(base.endsWith(".mjs") ? [base.slice(0, -4) + ".mts"] : []),
        `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts"), join(base, "index.tsx")]
        .find(candidate => existsSync(candidate) && /\.(?:ts|tsx|mts|mjs)$/.test(candidate));
      if (!target && !existsSync(base)) throw new Error(`Unresolved application import: ${file}: ${specifier}`);
      const result = target ? name(target) : null; targets.set(base, result); return result;
    };
    const visited = assertDormantGraph(roots, file => readFileSync(join(cwd, file), "utf8"), resolveImport, importsFor);
    const closedModules = new Set(["lib/db/enrolled-sqlite-adapter.ts", "lib/db/enrolled-supabase-adapter.ts", "lib/db/enrolled-sqlite-schema-profile.ts", "lib/db/chat-accounts-sqlite.ts"]);
    for (const file of [...files(join(cwd, "lib")), ...files(join(cwd, "scripts"))]) {
      const importer = name(file);
      if (/(?:\.test\.|-fixture\.|\/fixtures\/|^scripts\/test-)/.test(importer)) continue;
      for (const specifier of importsFor(importer)) {
        const target = resolveImport(importer, specifier);
        if (!target || !closedModules.has(target)) continue;
        // The closed factory may construct its fixed reference profile; no ordinary consumer may select either.
        const permitted = importer === applicationStorageBoundary && ["lib/db/enrolled-sqlite-adapter.ts", "lib/db/enrolled-supabase-adapter.ts"].includes(target)
          || importer === "lib/db/enrolled-sqlite-adapter.ts" && target === "lib/db/chat-accounts-sqlite.ts"
          || importer === "lib/db/enrolled-sqlite-adapter.ts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "lib/a2a/pending-owner-session.ts" && target === "lib/db/enrolled-sqlite-adapter.ts"
          || importer === "lib/accounts/sqlite-store.ts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "lib/db/deliverable-acceptance-sqlite.ts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "lib/db/decision-reviews-sqlite.ts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "lib/db/private-profiles-enrolled-sqlite.ts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "lib/db/private-bibliographies-enrolled-sqlite.ts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "lib/db/profile-identities-enrolled-sqlite.ts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "lib/db/public-profiles-sqlite.ts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/owner-run-assignment.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/restore-public-research.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          // Finite synthetic-only measurement; it cannot be reached by the application graph.
          || importer === "scripts/measure-enrolled-health.mts" && target === "lib/db/enrolled-sqlite-adapter.ts"
          || importer === "scripts/measure-enrolled-source-learning.mts" && target === "lib/db/enrolled-sqlite-adapter.ts"
          // Synthetic native/SQLite parity oracle; never imported by a runtime entry.
          || importer === "scripts/postgres/qualify-workspaces.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-usage.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-ledger.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-acceptance.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-native-runtime.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-operator-withdrawal.mts" && target === "lib/db/enrolled-sqlite-adapter.ts"
          || importer === "scripts/postgres/qualify-accounts.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-account-history.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-chat-links.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-public-profiles.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-owner-assignments.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-a2a-originals.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-a2a-create.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-a2a-fulfillment.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-publication.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-article-offers.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-browser-journal.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-onramp.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-payment-events.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-payment-observers.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-private-research.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-reference-archive.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-scholarly.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-research-purchases.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          // Source-only sealed DATA capture, not an application selector/issuer.
          || importer === "scripts/postgres/held-native-catchup-input.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/qualify-chat-links.mts" && target === "lib/db/chat-accounts-sqlite.ts"
          || importer === "scripts/postgres/native-account-fixture.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "scripts/postgres/native-chat-fixture.mts" && target === "lib/db/enrolled-sqlite-schema-profile.ts"
          || importer === "lib/db/storage-identity-connection.ts" && target === "lib/db/enrolled-sqlite-schema-profile.ts";
        expect(permitted, `Unreviewed storage selector: ${importer} -> ${target}`).toBe(true);
      }
    }
    expect(visited.has("scripts/owner-run-assignment.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-usage.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-a2a-originals.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-a2a-create.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-a2a-fulfillment.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-publication.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-research-purchases.mts")).toBe(false);
    expect(visited.has("scripts/postgres/held-native-catchup-input.mts")).toBe(false);
    expect(visited.has(preparedChild)).toBe(false);
    const inspectedHelpers = assertDormantGraph([...preparedHelperRoots.keys()], file => readFileSync(join(cwd, file), "utf8"), resolveImport, importsFor);
    for (const helper of preparedHelperRoots.keys()) expect(inspectedHelpers.has(helper)).toBe(true);
    expect(inspectedHelpers.has("scripts/next-public-observation.mjs")).toBe(true);
    expect(visited.has("scripts/postgres/qualify-ledger.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-acceptance.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-native-runtime.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-accounts.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-account-history.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-chat-links.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-public-profiles.mts")).toBe(false);
    expect(visited.has("scripts/postgres/native-public-profile-fixture.mts")).toBe(false);
    expect(visited.has("scripts/postgres/native-account-fixture.mts")).toBe(false);
    expect(visited.has("scripts/postgres/native-chat-fixture.mts")).toBe(false);
    // These shared bridges carry immutable identity/AAD data, not factory or enrollment selection.
    expect(visited.has("lib/db/sqlite-adapter.ts")).toBe(true);
    expect(visited.has("lib/a2a/pending-owner-session.ts")).toBe(true);
    expect(visited.has("lib/sources/enrolled-content-cache.ts")).toBe(true);
    expect(visited.has("lib/db/storage-identity.ts")).toBe(true);
    expect(visited.has("scripts/restore-public-research.mts")).toBe(false);
    expect(visited.has("scripts/measure-enrolled-health.mts")).toBe(false);
    expect(visited.has("scripts/postgres/qualify-workspaces.mts")).toBe(false);
    const measurementFile = "scripts/measure-enrolled-source-learning.mts";
    expect(visited.has(measurementFile)).toBe(false);
    const measurement = ts.createSourceFile(measurementFile,
      readFileSync(join(cwd, measurementFile), "utf8"), ts.ScriptTarget.Latest, true);
    let readonlyImports = 0;
    let readonlyCalls = 0;
    const inspectMeasurement = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
        && resolveImport(measurementFile, node.arguments[0].text) === "lib/db/enrolled-sqlite-adapter.ts") {
        readonlyImports++;
        if (!ts.isAwaitExpression(node.parent) || !ts.isVariableDeclaration(node.parent.parent)
          || !ts.isObjectBindingPattern(node.parent.parent.name)) throw new Error("Measurement must select only the readonly factory");
        expect(node.parent.parent.name.elements.map(binding => ({
          name: binding.name.getText(measurement), property: binding.propertyName?.getText(measurement),
          rest: !!binding.dotDotDotToken, fallback: !!binding.initializer,
        }))).toEqual([{ name: "createReadonlyEnrolledSqliteAdapter", property: undefined, rest: false, fallback: false }]);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === "createReadonlyEnrolledSqliteAdapter") {
        readonlyCalls++;
        expect(node.arguments).toHaveLength(0);
      }
      ts.forEachChild(node, inspectMeasurement);
    };
    inspectMeasurement(measurement);
    expect(readonlyImports).toBe(1);
    expect(readonlyCalls).toBe(1);
    const composition = readFileSync(join(process.cwd(), "lib/operator/gateway-funding-composition.ts"), "utf8");
    expect(composition).not.toMatch(/\bimport\s*\(/);
  });

  it.each(["lib/payments/gateway-funding-executor.ts", "lib/operator/gateway-funding-composition.ts",
    "lib/payments/gateway-funding-transaction.ts", "lib/db/storage-identity-provision.ts"])(
    "rejects %s even when hidden behind the admitted application storage role", forbidden => {
      const sources: Record<string, string> = {
        "app/entry.ts": "import '../lib/db/application-storage';",
        "lib/db/application-storage.ts": "import './enrolled-sqlite-adapter';",
        "lib/db/enrolled-sqlite-adapter.ts": `import '../../${forbidden}';`,
      };
      expect(() => assertDormantGraph(["app/entry.ts"], file => sources[file], (file, specifier) =>
        posix.resolve("/", posix.dirname(file), specifier).slice(1).replace(/\.(ts|tsx|mts)$/, "") + ".ts"))
        .toThrow("Dormant runtime reachable");
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

  it.each([...manifestObservationReaders])("permits the exact %s manifest observation while traversing its children", importer => {
    const sources: Record<string, string> = {
      "app/entry.ts": `import '../${importer.slice(0, -3)}';`,
      [importer]: "import { readRuntimeStorageDeployment } from '../db/runtime-storage-config';",
      "lib/db/runtime-storage-config.ts": "import { canonicalJson } from '../canonical-json';",
      "lib/canonical-json.ts": "export const canonicalJson = JSON.stringify;",
    };
    const visited = assertDormantGraph(["app/entry.ts"], file => sources[file], (file, specifier) =>
      posix.resolve("/", posix.dirname(file), specifier).slice(1) + ".ts");
    expect([...visited]).toEqual(["app/entry.ts", importer, "lib/db/runtime-storage-config.ts", "lib/canonical-json.ts"]);
  });

  for (const importer of manifestObservationReaders) {
    it.each(["lib/payments/gateway-funding-executor.ts", "lib/operator/gateway-funding-composition.ts",
      "lib/payments/gateway-funding-transaction.ts", "lib/db/storage-identity-provision.ts"])(
      `rejects %s beneath the reviewed ${importer} manifest edge`, forbidden => {
        const sources: Record<string, string> = {
          "app/entry.ts": `import '../${importer.slice(0, -3)}';`,
          [importer]: "import '../db/runtime-storage-config';",
          "lib/db/runtime-storage-config.ts": `export * from '../../${forbidden.slice(0, -3)}';`,
          [forbidden]: "",
        };
        expect(() => assertDormantGraph(["app/entry.ts"], file => sources[file], (file, specifier) =>
          posix.resolve("/", posix.dirname(file), specifier).slice(1) + ".ts")).toThrow("Dormant runtime reachable");
      });
    it(`does not permit ${importer} to select an enrolled factory directly`, () => {
      const sources: Record<string, string> = {
        "app/entry.ts": `import '../${importer.slice(0, -3)}';`,
        [importer]: "import '../db/runtime-storage-config'; void import('../db/enrolled-supabase-adapter');",
        "lib/db/runtime-storage-config.ts": "",
        "lib/db/enrolled-supabase-adapter.ts": "",
      };
      expect(() => assertDormantGraph(["app/entry.ts"], file => sources[file], (file, specifier) =>
        posix.resolve("/", posix.dirname(file), specifier).slice(1) + ".ts")).toThrow("Dormant runtime reachable");
    });
  }

  it.each(["lib/payments/mainnet-hosted-gateway-helper.ts", "lib/gateway/unified-balance-extra.ts",
    "lib/operator-obligations/inspection-helper.ts", "lib/sources/registration-sponsor-runtime-extra.ts"])(
    "refuses unreviewed near-match manifest reader %s", importer => {
      const sources: Record<string, string> = {
        "app/entry.ts": `import '../${importer.slice(0, -3)}';`,
        [importer]: "import '../db/runtime-storage-config';",
        "lib/db/runtime-storage-config.ts": "",
      };
      expect(() => assertDormantGraph(["app/entry.ts"], file => sources[file], (file, specifier) =>
        posix.resolve("/", posix.dirname(file), specifier).slice(1) + ".ts")).toThrow("Dormant runtime reachable");
    });

  it("keeps the chat-link native factory behind its exact application storage edge", () => {
    const sources: Record<string, string> = {
      "app/entry.ts": "import '../lib/db/chat-accounts-sqlite';",
      "lib/db/chat-accounts-sqlite.ts": "",
    };
    expect(() => assertDormantGraph(["app/entry.ts"], file => sources[file], (file, specifier) =>
      posix.resolve("/", posix.dirname(file), specifier).slice(1) + ".ts")).toThrow("Dormant runtime reachable");
  });

  it("keeps sealed catchup Source profile selection outside the application graph", () => {
    const sources: Record<string, string> = {
      "app/entry.ts": "import '../scripts/postgres/held-native-catchup-input';",
      "scripts/postgres/held-native-catchup-input.mts": "import '../../lib/db/enrolled-sqlite-schema-profile';",
      "lib/db/enrolled-sqlite-schema-profile.ts": "",
    };
    expect(() => assertDormantGraph(["app/entry.ts"], file => sources[file], (file, specifier) => {
      const target = posix.resolve("/", posix.dirname(file), specifier).slice(1);
      return target + (target === "scripts/postgres/held-native-catchup-input" ? ".mts" : ".ts");
    })).toThrow("Dormant runtime reachable");
  });

  const preparedLoaderImports = "import { join } from 'node:path'; import { pathToFileURL } from 'node:url';";
  it.each([...preparedHelperRoots])("maps only reviewed prepared helper %s to an inspected source edge", (helper, root) => {
    const source = `${preparedLoaderImports} void import(pathToFileURL(join(${root}, '${helper}')).href);`;
    const edge = "../" + helper.slice("scripts/".length);
    expect(runtimeImports(source, preparedChild)).toEqual(["node:path", "node:url", edge]);
    const sources: Record<string, string> = {
      [preparedChild]: source,
      [helper]: "import './pure-prepared-metadata.mjs';",
      "scripts/pure-prepared-metadata.mjs": "export const metadataOnly = true;",
    };
    const visited = assertDormantGraph([preparedChild], file => sources[file], (file, specifier) =>
      specifier.startsWith(".") ? posix.resolve("/", posix.dirname(file), specifier).slice(1) : null);
    expect([...visited]).toEqual([preparedChild, helper, "scripts/pure-prepared-metadata.mjs"]);
  });

  it.each([
    "pathToFileURL(join(source, 'scripts/unreviewed-helper.mjs')).href",
    "pathToFileURL(join(source, helper)).href",
    "pathToFileURL(join(source, `scripts/immutable-release-staging.mjs`)).href",
    "pathToFileURL(join(otherSource, 'scripts/immutable-release-staging.mjs')).href",
    "pathToFileURL(join(metadata.source, 'scripts/immutable-release-staging.mjs')).href",
    "pathToFileURL(join(source, 'scripts/next-public-server.mjs')).href",
    "pathToFileURL(join(metadata.other, 'scripts/next-public-server.mjs')).href",
    "pathToFileURL(join(source, 'scripts', 'immutable-release-staging.mjs')).href",
    "pathToFileURL(resolve(source, 'scripts/immutable-release-staging.mjs')).href",
    "pathToFileURL(path.join(source, 'scripts/immutable-release-staging.mjs')).href",
    "pathToFileURL(join(source, 'scripts/immutable-release-staging.mjs'), extra).href",
    "pathToFileURL(join(source, 'scripts/immutable-release-staging.mjs'))['href']",
    "pathToFileURL(join(source, 'scripts/immutable-release-staging.mjs'))?.href",
    "pathToFileURL?.(join(source, 'scripts/immutable-release-staging.mjs')).href",
    "url.pathToFileURL(join(source, 'scripts/immutable-release-staging.mjs')).href",
    "helperUrl",
  ])("refuses a near-match or variable prepared import: %s", argument => {
    expect(() => runtimeImports(`${preparedLoaderImports} void import(${argument});`, preparedChild)).toThrow("Unreviewed dynamic import");
  });

  it.each(["app/entry.ts", "scripts/postgres/prepared-next-child-extra.mts", "scripts/prepared-next-child.mts"])(
    "rejects the same dynamic loader outside the exact reviewed child: %s", file => {
      expect(() => runtimeImports(`${preparedLoaderImports} void import(pathToFileURL(join(source, 'scripts/immutable-release-staging.mjs')).href);`, file))
        .toThrow("Unreviewed dynamic import");
    });

  it.each([
    "const join = unreviewedJoin;",
    "function unreviewed(join) { return join; }",
    "const { pathToFileURL } = unreviewed;",
    "function pathToFileURL() {}",
  ])("rejects shadowed prepared loader bindings: %s", shadow => {
    expect(() => runtimeImports(`${preparedLoaderImports} ${shadow} void import(pathToFileURL(join(source, 'scripts/immutable-release-staging.mjs')).href);`, preparedChild))
      .toThrow("Unreviewed dynamic import");
  });

  it("rejects unbound/aliased functions and require instead of disguising an import", () => {
    const expression = "pathToFileURL(join(source, 'scripts/immutable-release-staging.mjs')).href";
    expect(() => runtimeImports(`void import(${expression});`, preparedChild)).toThrow("Unreviewed dynamic import");
    expect(() => runtimeImports(`import { join } from 'other-path'; import { pathToFileURL } from 'other-url'; void import(${expression});`, preparedChild)).toThrow("Unreviewed dynamic import");
    expect(() => runtimeImports(`${preparedLoaderImports} void require(${expression});`, preparedChild)).toThrow("Unreviewed dynamic import");
    expect(() => runtimeImports(`${preparedLoaderImports} void import(${expression}, {with:{type:'json'}});`, preparedChild)).toThrow("Unreviewed dynamic import");
  });

  it.each([...preparedHelperRoots])("still rejects a dormant funding descendant of prepared helper %s", (helper, root) => {
    const sources: Record<string, string> = {
      [preparedChild]: `${preparedLoaderImports} void import(pathToFileURL(join(${root}, '${helper}')).href);`,
      [helper]: "import '../lib/payments/gateway-funding-executor';",
      "lib/payments/gateway-funding-executor.ts": "",
    };
    expect(() => assertDormantGraph([preparedChild], file => sources[file], (file, specifier) => {
      if (!specifier.startsWith(".")) return null;
      const target = posix.resolve("/", posix.dirname(file), specifier).slice(1);
      return target.endsWith(".mjs") ? target : target + ".ts";
    })).toThrow("Dormant runtime reachable");
  });

  it("keeps the prepared artifact loader unreachable from the application even through an ordinary helper", () => {
    const read = vi.fn((file: string) => file === "app/entry.ts" ? "import './helper';" : "import '../scripts/postgres/prepared-next-child';");
    expect(() => assertDormantGraph(["app/entry.ts"], read, (file, specifier) => {
      const target = posix.resolve("/", posix.dirname(file), specifier).slice(1);
      return target + (target === "scripts/postgres/prepared-next-child" ? ".mts" : ".ts");
    })).toThrow("Dormant runtime reachable");
    expect(read).not.toHaveBeenCalledWith(preparedChild);
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
