import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateUiPreviews } from "./generate-ui-previews.mjs";

// Parse source only. Do not load application modules, credentials or JSX runtimes.
const ts = createRequire(import.meta.url)("typescript");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselineFile = "locales/ui-copy-baseline.json";
const textAttributes = new Set(["alt", "title", "placeholder", "aria-label", "aria-description",
  "aria-valuetext", "aria-roledescription", "label", "description", "caption", "tooltip",
  "emptyText", "loadingText", "errorText", "successText"]);
const descriptorProperties = new Set(["label", "placeholder", "emptyText", "tooltip", "successMessage", "errorMessage", "ariaLabel"]);
const metadataProperties = new Set(["title", "description", "alt"]);
const metadataTitleProperties = new Set(["default", "template", "absolute"]);
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
    const context = `${node.pos}:${kind}`;
    if (!/[\p{L}\p{N}]/u.test(text) || recorded.has(context)) return;
    recorded.add(context);
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
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "source" &&
      node.parent.parent.tagName?.getText(ast) === "UiText" && node.initializer) {
      rendered(ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer, "jsx-expression");
    }
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) rendered(node.expression, "jsx-expression");
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (textAttributes.has(name) && ts.isObjectLiteralExpression(node.parent) &&
        ts.isJsxExpression(node.parent.parent) && ts.isJsxAttribute(node.parent.parent.parent) &&
        node.parent.parent.parent.name.getText(ast) === "attributes" &&
        node.parent.parent.parent.parent.parent.tagName?.getText(ast) === "UiElement") rendered(node.initializer, "attribute");
      const metadata = insideMetadata(node);
      const title = metadata && name === "title" ? constantExpression(node.initializer) : undefined;
      if (title && ts.isObjectLiteralExpression(title)) {
        // Next title objects expose only these presentation leaves. Do not turn
        // arbitrary default/template data objects into visible-copy candidates.
        title.properties.forEach(property => {
          if (ts.isPropertyAssignment(property) && metadataTitleProperties.has(propertyName(property.name))) rendered(property.initializer, "descriptor");
          if (ts.isShorthandPropertyAssignment(property) && metadataTitleProperties.has(property.name.text)) rendered(property.name, "descriptor");
        });
      } else if (descriptorProperties.has(name) || (metadata && metadataProperties.has(name))) rendered(node.initializer, "descriptor");
    }
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

/** Bind normalized source bytes without importing/evaluating English modules. */
export function uiSourceSha256(source) {
  return createHash("sha256").update(source.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}
function plainFields(value, names) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), "Invalid draft prototype");
  const fields = Object.getOwnPropertyDescriptors(value);
  requireCondition(Reflect.ownKeys(value).length === Object.keys(fields).length &&
    Object.values(fields).every(field => field.enumerable && "value" in field), "Invalid draft descriptors");
  if (names) requireCondition(Object.keys(fields).sort().join(",") === [...names].sort().join(","), "Unknown/missing draft fields");
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
}
function draftTokens(text) {
  return [...text.matchAll(/\$\{[^}]+\}|\{[A-Za-z][A-Za-z0-9]*\}/gu)].map(match => match[0]).sort();
}
const immutableTerms = /(?<![A-Za-z0-9])(?:USDC|Arc|x402|BUY|SKIP|CACHE)(?![A-Za-z0-9])/gu;
// Standalone source labels use existing glossary IDs; their exact English source
// need not equal the glossary's longer display label (Pending vs Pending confirmation).
function glossaryTerm(source, glossary) {
  const label = source.trim().toLowerCase();
  const aliases = { cap: "cap", "source toll": "source-toll", "source tolls": "source-toll",
    "citation reward": "citation-reward", "citation rewards": "citation-reward", "creator payout": "creator-payout" };
  if (Object.hasOwn(aliases, label)) return aliases[label];
  if (Object.hasOwn(glossary.terms, label)) return label;
  return Object.keys(glossary.terms).find(id => glossary.terms[id].text.toLowerCase() === label);
}

/** Extend the source-only AST path to namespace leaves and core-inline literals. */
export function extractNamespaceCopy(filename, source, resolveAlias = () => undefined) {
  const entries = Object.create(null), aliases = Object.create(null);
  function add(key, text) {
    requireCondition(!Object.hasOwn(entries, key), `${filename}: conflicting leaf ${key}`);
    entries[key] = text;
  }
  if (filename.endsWith(".json")) {
    JSON.parse(source); // Strict JSON syntax, but do not silently collapse duplicate keys.
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSON);
    const walk = (node, prefix) => {
      if (ts.isStringLiteral(node)) add(prefix, node.text);
      else if (ts.isObjectLiteralExpression(node)) {
        const keys = new Set();
        for (const prop of node.properties) {
          const key = propertyName(prop.name);
          requireCondition(!keys.has(key), `${filename}: duplicate structural leaf ${prefix}.${key}`);
          keys.add(key); walk(prop.initializer, prefix ? `${prefix}.${key}` : key);
        }
      } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach((child, i) => walk(child, prefix ? `${prefix}.${i}` : String(i)));
    };
    walk(ast.statements[0].expression, "");
  } else {
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    requireCondition(!ast.parseDiagnostics.length, `${filename}: source cannot be parsed`);
    const roots = new Map(), declarations = new Map(), leaves = [];
    for (const statement of ast.statements) if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) {
        declarations.set(declaration.name.text, declaration);
      }
    }
    function root(node, identity) {
      const visited = new Set();
      let resolved = node;
      while (resolved && !visited.has(resolved)) {
        visited.add(resolved);
        if (ts.isIdentifier(resolved)) resolved = constantInitializer(resolved);
        else if (ts.isParenthesizedExpression(resolved) || ts.isAsExpression(resolved) || ts.isSatisfiesExpression(resolved) || ts.isNonNullExpression(resolved)) resolved = resolved.expression;
        else if (ts.isCallExpression(resolved) && resolved.expression.getText(ast) === "Object.freeze") resolved = resolved.arguments[0];
        else break;
      }
      requireCondition(resolved && !(ts.isIdentifier(resolved) || ts.isCallExpression(resolved)), `${filename}: unresolved/cyclic root ${identity}`);
      // Re-export aliases are the same declaration, not independent leaves.
      if (roots.has(resolved)) return;
      let declaration = resolved.parent;
      while (declaration && !ts.isVariableDeclaration(declaration)) declaration = declaration.parent;
      roots.set(resolved, declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : identity);
    }
    function exported(node, identity) {
      // CJS export wrappers expose declarations; do not walk those twice.
      if (ts.isObjectLiteralExpression(node) && node.properties.every(prop => ts.isShorthandPropertyAssignment(prop) ||
        (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer)))) {
        for (const prop of node.properties) {
          if (ts.isShorthandPropertyAssignment(prop)) root(prop.name, prop.name.text);
          else if (ts.isPropertyAssignment(prop)) root(prop.initializer, propertyName(prop.name));
          else requireCondition(false, `${filename}: unsupported export wrapper`);
        }
      } else root(node, identity);
    }
    for (const statement of ast.statements) {
      if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) root(declaration.initializer, declaration.name.text);
      } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) if (!element.isTypeOnly) {
          const name = (element.propertyName ?? element.name).text;
          requireCondition(!statement.moduleSpecifier && declarations.has(name), `${filename}: unresolved exported root ${name}`);
          root(declarations.get(name).initializer, name);
        }
      } else if (ts.isExportAssignment(statement)) root(statement.expression, "default");
      else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) &&
        statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const assignment = statement.expression, target = assignment.left.getText(ast);
        if (target === "module.exports") exported(assignment.right, "module.exports");
        else if (/^(?:module\.exports|exports)\.[A-Za-z_$][\w$]*$/.test(target)) root(assignment.right, target);
      }
    }
    if (filename === "lib/i18n/messages.ts") {
      roots.clear();
      requireCondition(declarations.has("englishMessages"), `${filename}: missing englishMessages`);
      root(declarations.get("englishMessages").initializer, "englishMessages");
    } else if (!roots.size) {
      for (const declaration of declarations.values()) root(declaration.initializer, declaration.name.text);
    }
    function walk(node, prefix, identity, active = new Set()) {
      if (!node) return;
      requireCondition(!active.has(node), `${filename}: cyclic source alias ${prefix}`);
      const next = new Set(active).add(node);
      const descend = (child, key = prefix) => walk(child, key, identity, next);
      const leaf = (text, alias) => leaves.push({ identity, key: prefix, text, alias });
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return descend(node.expression);
      if (ts.isIdentifier(node)) {
        const initializer = constantInitializer(node);
        requireCondition(initializer, `${filename}: unresolved source alias ${node.text}`);
        return descend(initializer);
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return leaf(node.text);
      if (ts.isTemplateExpression(node)) return leaf(node.getText(ast).slice(1, -1));
      if (ts.isObjectLiteralExpression(node)) {
        for (const prop of node.properties) if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
          const key = propertyName(prop.name);
          requireCondition(key !== undefined, `${filename}: unsupported computed leaf`);
          descend(ts.isPropertyAssignment(prop) ? prop.initializer : prop.name, prefix ? `${prefix}.${key}` : key);
        } else requireCondition(filename === "lib/i18n/messages.ts" && ts.isSpreadAssignment(prop), `${filename}: unsupported source property`);
      } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach((child, i) => descend(child, prefix ? `${prefix}.${i}` : String(i)));
      else if (ts.isCallExpression(node) && node.expression.getText(ast) === "Object.freeze") descend(node.arguments[0]);
      else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) descend(node.body);
      else if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) {
        const expression = node.getText(ast), text = resolveAlias(expression);
        requireCondition(typeof text === "string", `${filename}: unresolved source alias ${expression}`);
        leaf(text, expression);
      }
    }
    for (const [node, identity] of roots) walk(node, "", identity);
    const owners = new Map(), structural = new Set();
    for (const leaf of leaves) {
      const structuralKey = JSON.stringify([leaf.identity, leaf.key]);
      requireCondition(!structural.has(structuralKey), `${filename}: duplicate structural leaf ${leaf.identity}.${leaf.key}`);
      structural.add(structuralKey);
      owners.set(leaf.key, (owners.get(leaf.key) ?? 0) + 1);
    }
    for (const leaf of leaves) {
      // Distinct roots remain distinct even when their English text is equal.
      const key = owners.get(leaf.key) > 1 ? `${leaf.identity}.${leaf.key}` : leaf.key;
      add(key, leaf.text);
      if (leaf.alias) aliases[key] = leaf.alias;
    }
  }
  return { sourcePath: filename, sourceSha256: uiSourceSha256(source), entries, aliases };
}

/** Partial drafts are preparation; completeness is separately derived from every leaf. */
export function validateNamespaceDraft(draft, binding, glossary) {
  const fields = plainFields(draft, ["status", "review", "sourcePath", "sourceSha256", "entries"]);
  requireCondition(fields.status === "machineDraft" && fields.review === null, "Draft cannot claim human approval");
  requireCondition(fields.sourcePath === binding.sourcePath && fields.sourceSha256 === binding.sourceSha256, "Stale namespace source binding");
  const entries = plainFields(fields.entries), covered = [];
  for (const [key, raw] of Object.entries(entries)) {
    requireCondition(Object.hasOwn(binding.entries, key), `Unknown namespace key: ${key}`);
    const entry = plainFields(raw), source = binding.entries[key];
    requireCondition(entry.source === source, `Stale English leaf: ${key}`);
    if (Object.hasOwn(entry, "term")) {
      plainFields(raw, ["source", "term"]);
      requireCondition(typeof entry.term === "string" && Object.hasOwn(glossary.terms, entry.term) &&
        glossaryTerm(source, glossary) === entry.term, `Invalid glossary reference: ${key}`);
      const expected = glossary.messages[key]?.term;
      requireCondition(!expected || expected === entry.term, `Wrong critical term: ${key}`);
    } else {
      plainFields(raw, ["source", "text"]);
      requireCondition(!glossary.messages[key]?.term && !glossaryTerm(source, glossary), `Critical label requires glossary term: ${key}`);
      requireCondition(typeof entry.text === "string" && entry.text.trim() && entry.text.length <= 16000 &&
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(entry.text), `Invalid draft text: ${key}`);
      requireCondition(JSON.stringify(draftTokens(source)) === JSON.stringify(draftTokens(entry.text)), `Changed placeholders: ${key}`);
      requireCondition(JSON.stringify([...source.matchAll(immutableTerms)].map(m => m[0]).sort()) ===
        JSON.stringify([...entry.text.matchAll(immutableTerms)].map(m => m[0]).sort()), `Changed protocol terms: ${key}`);
    }
    covered.push(key);
  }
  return { coveredKeys: covered.sort(), uncoveredKeys: Object.keys(binding.entries).filter(key => !Object.hasOwn(entries, key)).sort() };
}

export function scanNamespaceDrafts(root = repoRoot) {
  function readNamespaceFile(filename) {
    const absolute = path.join(root, filename), relative = path.relative(realpathSync(root), realpathSync(absolute));
    requireCondition(lstatSync(absolute).isFile() && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `${filename}: catalogue path escapes the checkout or is not regular`);
    return readFileSync(absolute, "utf8");
  }
  const files = readdirSync(path.join(root, "locales/en")).filter(file => /\.(?:ts|json|cjs)$/.test(file)).sort();
  const helpers = extractNamespaceCopy("locales/en/shared-helpers.ts", readNamespaceFile("locales/en/shared-helpers.ts"));
  const resolve = expression => {
    const match = /^sharedHelperMessages\["([^\"]+)"\]$/.exec(expression);
    return match ? helpers.entries[match[1]] : undefined;
  };
  const bindings = [...files.map(file => `locales/en/${file}`), "lib/i18n/messages.ts"].map(file => ({
    namespace: file === "lib/i18n/messages.ts" ? "core-inline" : path.basename(file).replace(/\.[^.]+$/, ""),
    ...extractNamespaceCopy(file, readNamespaceFile(file), resolve),
  }));
  const glossary = JSON.parse(readNamespaceFile("locales/glossary/en.json"));
  const summaries = [];
  for (const locale of ["vi", "zh-Hans"]) {
    const manifest = plainFields(JSON.parse(readNamespaceFile(`locales/${locale}/ui-drafts/manifest.json`)));
    requireCondition(manifest.locale === locale && manifest.status === "machineDraft" && manifest.review === null && manifest.authority === "en" &&
      Array.isArray(manifest.namespaces) && manifest.namespaces.length === bindings.length, `${locale}: invalid manifest metadata/inventory`);
    const seen = new Set(), totals = { englishNamespaceFiles: files.length, coreInlineSources: 1, extractedLeaves: 0,
      authoredEntries: 0, nonTranslatableMachineIdentifiers: 0, uncoveredEntries: 0, completeNamespaces: 0 };
    for (const raw of manifest.namespaces) {
      const row = plainFields(raw), binding = bindings.find(item => item.namespace === row.namespace);
      requireCondition(binding && !seen.has(row.namespace), `${locale}: unknown/duplicate manifest namespace`); seen.add(row.namespace);
      const draftPath = `locales/${locale}/ui-drafts/${binding.namespace}.json`;
      requireCondition(row.sourcePath === binding.sourcePath && row.sourceSha256 === binding.sourceSha256 && row.draftPath === draftPath,
        `${locale}/${binding.namespace}: stale manifest binding`);
      const result = validateNamespaceDraft(JSON.parse(readNamespaceFile(draftPath)), binding, glossary);
      requireCondition(Array.isArray(row.nonTranslatableMachineIdentifiers) && Array.isArray(row.coveredKeys) && Array.isArray(row.uncoveredKeys), "Invalid manifest coverage lists");
      const preserved = new Set();
      for (const rawIdentifier of row.nonTranslatableMachineIdentifiers) {
        const identifier = plainFields(rawIdentifier, ["key", "value", "reason"]);
        requireCondition(typeof identifier.key === "string" && Object.hasOwn(binding.entries, identifier.key) &&
          identifier.value === binding.entries[identifier.key] && typeof identifier.reason === "string" && identifier.reason.trim() &&
          ((binding.namespace === "checked-bibliography-exports" && /^\d+\.format$/.test(identifier.key)) ||
            (binding.namespace === "get-started" && /^surfaces\.\d+\.(?:id|href)$/.test(identifier.key)) ||
            (binding.namespace === "operations" && identifier.key === "businessCalculator.borderBorderInkPx4Py2Font" &&
              identifier.value === "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40") ||
            (binding.namespace === "research-mandates" && identifier.key === "api" && identifier.value === "POST /api/research/mandates") ||
            (binding.namespace === "research-mandates" && identifier.key === "command" &&
              identifier.value === "node --import tsx scripts/research-mandate.mts --input policy.json") ||
            /^(?:https?:\/\/\S+|\/[A-Za-z0-9_#/?=&.-]+)$/.test(identifier.value)) &&
          !preserved.has(identifier.key) && !result.coveredKeys.includes(identifier.key), "Invalid/overlapping preserved identifier");
        preserved.add(identifier.key);
      }
      const uncovered = result.uncoveredKeys.filter(key => !preserved.has(key));
      const equalKeys = (actual, expected) => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
      requireCondition(equalKeys(row.coveredKeys, result.coveredKeys) && equalKeys(row.uncoveredKeys, uncovered) &&
        row.extractedLeaves === Object.keys(binding.entries).length && row.authoredEntries === result.coveredKeys.length &&
        JSON.stringify(Object.entries(plainFields(row.sourceAliases)).sort()) === JSON.stringify(Object.entries(binding.aliases).sort()),
        `${locale}/${binding.namespace}: dishonest coverage or aliases`);
      totals.extractedLeaves += row.extractedLeaves; totals.authoredEntries += row.authoredEntries;
      totals.nonTranslatableMachineIdentifiers += preserved.size; totals.uncoveredEntries += uncovered.length;
      if (!uncovered.length) totals.completeNamespaces += 1;
    }
    const recordedTotals = plainFields(manifest.totals, Object.keys(totals));
    requireCondition(Object.entries(totals).every(([key, value]) => recordedTotals[key] === value) &&
      manifest.complete === (totals.uncoveredEntries === 0), `${locale}: dishonest completeness totals`);
    summaries.push({ locale, ...totals, complete: manifest.complete });
  }
  return summaries;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireCondition(args.length === 0 || (args.length === 1 && args[0] === "--write-baseline"), "Usage: node scripts/check-ui-copy.mjs [--write-baseline]");
    const scan = scanRepository();
    for (const draft of scanNamespaceDrafts()) console.log(`${draft.locale}: ${draft.authoredEntries} machine-draft entries, ${draft.nonTranslatableMachineIdentifiers} preserved identifiers, ${draft.uncoveredEntries} uncovered; no human approval or activation.`);
    generateUiPreviews(true);
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
