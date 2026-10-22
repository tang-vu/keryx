import ts from "typescript";

export type NextWorkerDescriptor = { bootstrap: string; chunks: string[] };

function unparenthesized(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function literalChunk(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node)) return node.text;
  if (!ts.isObjectLiteralExpression(node)) return null;
  let path: string | null = null;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)
      || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) return null;
    if (property.name.text !== "path") continue;
    if (path !== null || !ts.isStringLiteral(property.initializer)) return null;
    path = property.initializer.text;
  }
  return path;
}

/** Read literal emitted module calls without evaluating client code or relying on
 * the helper's export name. Next 16.4 mangles that name, including `default`.
 * Every returned file must be present in this same inspected build. */
export function nextWorkerDescriptor(
  packagedFiles: ReadonlyMap<string, string>, entryUrl: string,
): NextWorkerDescriptor | null {
  if (!packagedFiles.has(entryUrl) || !entryUrl.startsWith("/_next/static/chunks/")) return null;
  const entry = entryUrl.slice("/_next/".length);
  const found = new Map<string, NextWorkerDescriptor>();
  const present = (path: string) => path.startsWith("static/chunks/")
    && !/[\\?#\u0000-\u0020]/.test(path)
    && !path.slice("static/chunks/".length).includes("/")
    && path.endsWith(".js") && packagedFiles.has(`/_next/${path}`);
  for (const [filename, source] of packagedFiles) {
    if (!source.includes("static/chunks/turbopack-worker-")) continue;
    const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    if ((parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return null;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.arguments.length === 2) {
        const callee = unparenthesized(node.expression);
        const moduleExport = ts.isPropertyAccessExpression(callee)
          || (ts.isElementAccessExpression(callee) && callee.argumentExpression
            && ts.isStringLiteral(callee.argumentExpression));
        const [bootstrap, chunkArray] = node.arguments;
        if (moduleExport && ts.isCallExpression(unparenthesized(callee.expression))
          && ts.isStringLiteral(bootstrap)
          && /^static\/chunks\/turbopack-worker-[^/\\?#\s]+\.js$/.test(bootstrap.text)
          && present(bootstrap.text) && ts.isArrayLiteralExpression(chunkArray)
          && chunkArray.elements.length > 0 && chunkArray.elements.length <= 64) {
          const chunks = chunkArray.elements.map(literalChunk);
          if (chunks.every((chunk): chunk is string => chunk !== null && present(chunk))
            && new Set(chunks).size === chunks.length && chunks.includes(entry)) {
            const descriptor = { bootstrap: bootstrap.text, chunks };
            found.set(JSON.stringify(descriptor), descriptor);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
  }
  return found.size === 1 ? found.values().next().value ?? null : null;
}
