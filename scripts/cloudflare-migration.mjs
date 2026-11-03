/** Read-only source inventory; never deploys, changes DNS, reads credentials, or opens a database. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateMigrationMonth } from "../cloudflare/migration/src/cost-estimate.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const slash = value => value.replaceAll("\\", "/");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const sourceFiles = new Set(tracked.filter(path => /\.[cm]?[jt]sx?$/.test(path)));
const entries = [...sourceFiles].filter(path => /^app\//.test(path) && /\/(?:page|route|layout)\.[jt]sx?$/.test(path));
for (const path of ["proxy.ts", "instrumentation.ts"]) if (sourceFiles.has(path)) entries.push(path);
const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true,
  resolveJsonModule: true, baseUrl: root, paths: { "@/*": ["./*"] } };
const graph = new Map(), builtinFiles = new Map();
const runtimeConstraints = new Map([
  ["node:sqlite", "Replace file-backed native SQLite and its authority boundary with an accepted managed-storage adapter"],
  ["node:child_process", "Move subprocess work to isolated Containers or a parity-checked Worker implementation"],
  ["node:worker_threads", "Replace native threads; Worker compatibility import is a non-functional stub"],
]);

function imports(file) {
  const tree = ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true);
  const specifiers = new Set();
  function visit(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.importClause?.namedBindings;
      const onlyTypes = !node.importClause?.name && named && ts.isNamedImports(named)
        && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly);
      if (!onlyTypes) specifiers.add(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      specifiers.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); return [...specifiers];
}

function walk(file) {
  if (graph.has(file)) return;
  const edges = []; graph.set(file, edges);
  for (const specifier of imports(file)) {
    const normalized = specifier.startsWith("node:") ? specifier : `node:${specifier}`;
    if (runtimeConstraints.has(normalized)) {
      const files = builtinFiles.get(normalized) ?? new Set(); files.add(file); builtinFiles.set(normalized, files);
    }
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
    const found = ts.resolveModuleName(specifier, resolve(root, file), options, ts.sys).resolvedModule;
    if (!found) continue;
    const target = slash(relative(root, found.resolvedFileName));
    if (!sourceFiles.has(target) || target.startsWith("../") || /(?:\.test\.|test-support\/)/.test(target)) continue;
    edges.push(target); walk(target);
  }
}
for (const entry of entries) walk(entry);

const dbPath = "lib/db/keryx-db.ts", dbText = readFileSync(resolve(root, dbPath), "utf8");
const dbTree = ts.createSourceFile(dbPath, dbText, ts.ScriptTarget.Latest, true);
const contract = dbTree.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === "KeryxDB");
const methods = contract?.members.filter(ts.isMethodSignature).map(node => node.name.getText(dbTree)).sort() ?? [];
if (!methods.length) throw new Error("Persistence contract inventory unavailable");
const constraints = [...builtinFiles].map(([module, files]) => ({ module, requirement: runtimeConstraints.get(module), files: [...files].sort() }));
const report = {
  format: "keryx-cloudflare-source-inventory-v1",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  pages: entries.filter(path => /\/page\./.test(path)).length,
  routes: entries.filter(path => /\/route\./.test(path)).length,
  reachableSourceFiles: graph.size,
  persistenceContract: { path: dbPath, sha256: createHash("sha256").update(dbText).digest("hex"), methods },
  runtimeConstraints: constraints,
  costEstimate: estimateMigrationMonth(),
  productionReady: false,
  remaining: ["Managed-storage contract parity", "browser co-sign instance routing", "native extraction isolation",
    "custody and retained-original migration", "fresh privacy/revocation reads", "long-job recovery",
    "required exact-source CI and supported-surface acceptance", "Cloudflare-only traffic and latency comparison"],
};
if (process.argv.includes("--summary")) {
  console.log(JSON.stringify({ ...report,
    persistenceContract: { path: dbPath, methodCount: methods.length, sha256: report.persistenceContract.sha256 },
    runtimeConstraints: constraints.map(({ module, files, requirement }) => ({ module, fileCount: files.length, requirement })),
  }, null, 2));
} else console.log(JSON.stringify(report, null, 2));
