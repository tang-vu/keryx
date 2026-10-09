import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Parse source only. Do not load application modules, credentials or JSX runtimes.
const ts = createRequire(import.meta.url)("typescript");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselineFile = "locales/ui-copy-baseline.json";
const textAttributes = new Set(["alt", "title", "placeholder", "aria-label", "aria-description",
  "aria-valuetext", "aria-roledescription", "label", "description", "caption", "tooltip",
  "emptyText", "loadingText", "errorText", "successText"]);
const descriptorProperties = new Set(["label", "placeholder", "emptyText", "tooltip", "successMessage", "errorMessage", "ariaLabel"]);
const metadataProperties = new Set(["title", "description", "alt"]);
const scopes = ["app", "components", "desktop/src"];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;
}

function bindsName(binding, name) {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) &&
    binding.elements.some(element => ts.isBindingElement(element) && bindsName(element.name, name));
}

function constantInitializer(identifier) {
  const name = identifier.text;
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    if (ts.isSourceFile(scope) || ts.isBlock(scope)) {
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (bindsName(declaration.name, name)) {
            return ts.isIdentifier(declaration.name) && statement.declarationList.flags & ts.NodeFlags.Const ? declaration.initializer : undefined;
          }
        }
      }
    }
    if (ts.isFunctionLike(scope) && scope.parameters.some(parameter => bindsName(parameter.name, name))) {
      return undefined; // A data parameter must not resolve to a same-named outer label.
    }
  }
  return undefined;
}

function constantExpression(node, visited = new Set()) {
  while (node && !visited.has(node)) {
    visited.add(node);
    if (ts.isIdentifier(node)) node = constantInitializer(node);
    else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
    else return node;
  }
  return undefined;
}

function insideMetadata(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.name.text === "metadata") return true;
    if (ts.isFunctionLike(parent) && parent.name && propertyName(parent.name) === "generateMetadata") return true;
  }
  return false;
}

export function extractUiCopy(filename, source) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  requireCondition(ast.parseDiagnostics.length === 0, `${filename}: source cannot be parsed`);
  const findings = [];
  const recorded = new Set();

  function add(node, kind, text) {
    // Whitespace and decorative punctuation alone do not need language catalogues.
    if (!/[\p{L}\p{N}]/u.test(text) || recorded.has(node.pos)) return;
    recorded.add(node.pos);
    const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    findings.push({ file: filename, kind, text, line: position.line + 1 });
  }

  function rendered(node, kind, visited = new Set()) {
    if (!node || visited.has(node)) return;
    visited.add(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      add(node, kind, node.text);
    } else if (ts.isTemplateExpression(node)) {
      if ([node.head.text, ...node.templateSpans.map(span => span.literal.text)].some(text => /[\p{L}\p{N}]/u.test(text))) {
        add(node, kind, node.head.text + node.templateSpans.map(span => "${value}" + span.literal.text).join(""));
      }
      node.templateSpans.forEach(span => rendered(span.expression, kind, visited));
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
      rendered(node.expression, kind, visited);
    } else if (ts.isConditionalExpression(node)) {
      rendered(node.whenTrue, kind, visited); rendered(node.whenFalse, kind, visited);
    } else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) {
      if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) rendered(node.left, kind, visited);
      rendered(node.right, kind, visited);
    } else if (ts.isIdentifier(node)) {
      rendered(constantInitializer(node), kind, visited);
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(element => rendered(element, kind, visited));
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const object = constantExpression(node.expression);
      if (object && ts.isObjectLiteralExpression(object)) {
        const key = ts.isPropertyAccessExpression(node) ? node.name.text :
          node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
        object.properties.forEach(property => {
          if (ts.isPropertyAssignment(property) && (key === undefined || propertyName(property.name) === key)) rendered(property.initializer, kind, visited);
          if (ts.isShorthandPropertyAssignment(property) && (key === undefined || property.name.text === key)) rendered(property.name, kind, visited);
        });
      }
    }
    // Calls and nested JSX are not recursively treated as text: class names,
    // event arguments, catalogue keys and data formatting options are not labels.
    // The normal AST walk independently visits nested JSX and known UI calls.
  }

  function visit(node) {
    if (ts.isJsxText(node)) add(node, "jsx-text", node.text.replace(/\s+/g, " ").trim());
    if (ts.isJsxAttribute(node) && textAttributes.has(node.name.getText(ast)) && node.initializer) {
      rendered(ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer, "attribute");
    }
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) rendered(node.expression, "jsx-expression");
    if (ts.isPropertyAssignment(node) && (descriptorProperties.has(propertyName(node.name)) ||
      (insideMetadata(node) && metadataProperties.has(propertyName(node.name))))) rendered(node.initializer, "descriptor");
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : undefined;
      const toast = name === "toast" || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "toast");
      if (toast || ["alert", "confirm", "prompt", "setError", "setErrorMessage", "setSuccessMessage", "setStatusMessage"].includes(name)) {
        rendered(node.arguments[0], "ui-call");
        if (toast && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
          node.arguments[1].properties.forEach(property => {
            if (ts.isPropertyAssignment(property) && propertyName(property.name) === "description") rendered(property.initializer, "ui-call");
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return findings;
}

function findingKey(finding) {
  return createHash("sha256").update(JSON.stringify([finding.file, finding.kind, finding.text])).digest("hex");
}

export function makeBaseline(findings, sourceCommit, parserVersion = ts.version) {
  const counts = new Map();
  for (const finding of findings) {
    const key = findingKey(finding);
    const entry = counts.get(key) ?? { file: finding.file, kind: finding.kind, sha256: key, count: 0 };
    entry.count += 1; counts.set(key, entry);
  }
  return { schemaVersion: 1, sourceCommit, parserVersion, entries: [...counts.values()].sort((a, b) =>
    a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind) || a.sha256.localeCompare(b.sha256)) };
}

export function compareBaseline(findings, baseline) {
  requireCondition(baseline?.schemaVersion === 1 && typeof baseline.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(baseline.sourceCommit) &&
    baseline.parserVersion === ts.version && Array.isArray(baseline.entries), "Invalid baseline metadata or parser version");
  const allowed = new Map();
  for (const entry of baseline.entries) {
    requireCondition(entry && typeof entry.file === "string" && /^(?:app|components|desktop\/src)\/.+\.[jt]sx$/.test(entry.file) &&
      !entry.file.split("/").some(part => ["..", ".", ""].includes(part)) &&
      ["jsx-text", "jsx-expression", "attribute", "descriptor", "ui-call"].includes(entry.kind) &&
      typeof entry.sha256 === "string" && /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.count) && entry.count > 0 &&
      !allowed.has(entry.sha256), "Invalid or duplicate baseline entry");
    allowed.set(entry.sha256, { ...entry, remaining: entry.count });
  }
  const newCopy = [];
  for (const finding of findings) {
    const key = findingKey(finding), entry = allowed.get(key);
    if (entry) requireCondition(entry.file === finding.file && entry.kind === finding.kind, "Baseline entry has mismatched source metadata");
    if (entry?.remaining > 0) entry.remaining -= 1;
    else newCopy.push(finding);
  }
  return newCopy;
}

export function scanRepository(root = repoRoot) {
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  requireCondition(lock.packages?.["node_modules/typescript"]?.version === ts.version, "Installed TypeScript must match the lockfile parser version");
  const files = execFileSync("git", ["ls-files", "--stage", "-z", "--", ...scopes], { cwd: root, encoding: "utf8", windowsHide: true })
    .split("\0").filter(Boolean).flatMap(record => {
      const match = /^(\d{6}) [a-f0-9]{40,64} ([0-3])\t(.+)$/.exec(record);
      requireCondition(match !== null, "Invalid Git source inventory");
      const [, mode, stage, filename] = match;
      if (!/\.[jt]sx$/.test(filename)) return [];
      requireCondition(["100644", "100755"].includes(mode) && stage === "0", `${filename}: source must be a regular merged Git file`);
      const absolute = path.join(root, filename);
      const relative = path.relative(realpathSync(root), realpathSync(absolute));
      requireCondition(lstatSync(absolute).isFile() && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative),
        `${filename}: source path escapes the checkout or is not regular`);
      return [filename];
    });
  requireCondition(files.length > 0, "No tracked JSX source files found");
  return { files: files.length, findings: files.flatMap(filename => extractUiCopy(filename, readFileSync(path.join(root, filename), "utf8"))) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireCondition(args.length === 0 || (args.length === 1 && args[0] === "--write-baseline"), "Usage: node scripts/check-ui-copy.mjs [--write-baseline]");
    const scan = scanRepository();
    if (args.length) {
      requireCondition(!process.env.CI && !process.env.GITHUB_ACTIONS, "CI cannot rewrite the UI copy baseline");
      requireCondition(execFileSync("git", ["diff", "--name-only", "HEAD", "--", ...scopes],
        { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim() === "", "Commit UI source changes before recording their baseline provenance");
      const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim();
      const { entries, ...metadata } = makeBaseline(scan.findings, commit);
      writeFileSync(path.join(repoRoot, baselineFile), JSON.stringify(metadata, null, 2).slice(0, -2) +
        ',\n  "entries": [\n' + entries.map(entry => "    " + JSON.stringify(entry)).join(",\n") + "\n  ]\n}\n");
      console.log(`Baselined ${scan.findings.length} detected literals in ${scan.files} JSX files. Existing copy is not migrated.`);
    } else {
      const newCopy = compareBaseline(scan.findings, JSON.parse(readFileSync(path.join(repoRoot, baselineFile), "utf8")));
      for (const finding of newCopy.slice(0, 30)) console.error(`${finding.file}:${finding.line} [${finding.kind}] ${JSON.stringify(finding.text.slice(0, 160))}`);
      requireCondition(newCopy.length === 0, `${newCopy.length} new literal UI copy occurrence(s); use an English catalogue or review a documented baseline exception.`);
      console.log(`UI copy guard passed: ${scan.files} JSX files, ${scan.findings.length} detected existing literals. No migration or translation approval is claimed.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "UI copy validation failed");
    process.exitCode = 1;
  }
}
