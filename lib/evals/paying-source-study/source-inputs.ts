import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { sha256 } from "./contract";

/** Conservative static application-input boundary, including unexecuted literal import branches. */
export function sourceInputs(root: string, entry: string): { files: Record<string, string>; unresolved: string[] } {
  const files = new Map<string, string>(); const unresolved: string[] = [];
  const relative = (absolute: string) => path.relative(root, absolute).replaceAll("\\", "/");
  function visit(absolute: string) {
    if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error("Study source escaped application root");
    const name = relative(absolute);
    if (files.has(name)) return;
    const content = fs.readFileSync(absolute, "utf8").replaceAll("\r\n", "\n");
    files.set(name, sha256(content));
    if (!/\.[cm]?tsx?$/.test(absolute)) return;
    const ast = ts.createSourceFile(absolute, content, ts.ScriptTarget.Latest, true);
    function resolve(specifier: string, node: ts.Node) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return; // Node/package inputs use the declared runtime/lock.
      const base = specifier.startsWith("@/") ? path.resolve(root, specifier.slice(2)) : path.resolve(path.dirname(absolute), specifier);
      const candidates = [base, ...[".ts", ".tsx", ".mts", ".cts", ".json"].map(ext => base + ext),
        ...["index.ts", "index.tsx", "index.mts"].map(file => path.join(base, file)), base.replace(/\.js$/, ".ts"), base.replace(/\.mjs$/, ".mts")];
      const found = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!found) unresolved.push(`${name}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: unresolved literal import`);
      else visit(found);
    }
    function walk(node: ts.Node) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier))
        resolve(node.moduleSpecifier.text, node);
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        resolve(node.moduleSpecifier.text, node);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const argument = node.arguments[0];
        if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) resolve(argument.text, node);
        else unresolved.push(`${name}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: nonliteral import/require`);
      }
      ts.forEachChild(node, walk);
    }
    walk(ast);
  }
  visit(path.resolve(entry));
  return { files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b, "en"))), unresolved: unresolved.sort() };
}
