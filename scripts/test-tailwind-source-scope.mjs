/** Exercise the installed Tailwind/PostCSS source graph against synthetic retained builds.
 * All fixture writes and cleanup stay in a new checked OS-temp directory. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { Scanner } from "@tailwindcss/oxide";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryParent = await realpath(tmpdir());
const fixture = await mkdtemp(path.join(temporaryParent, "keryx-tailwind-source-"));
const modules = path.join(fixture, "node_modules");
let linked = false;
try {
  for (const directory of ["app", "components/keryx", "components/ui", "lib", "shared"])
    await mkdir(path.join(fixture, directory), { recursive: true });
  // Real authored class sources cover the home layout, conditional trace chips,
  // component variants, responsive arbitrary values and browser grant controls.
  for (const file of ["app/globals.css", "app/page.tsx", "components/keryx/phase-style.ts",
    "components/keryx/grant-spend-dialog.tsx", "components/ui/button.tsx", "components/ui/dialog.tsx", "shared/design-tokens.css"])
    await writeFile(path.join(fixture, file), await readFile(path.join(repository, file)));
  await symlink(path.join(repository, "node_modules"), modules, process.platform === "win32" ? "junction" : "dir");
  linked = true;

  const retained = [".next.bak", ".next.retained-synthetic", ".next.failed-synthetic"];
  const excludedRoots = [...retained, "scripts", "docs", "desktop", "extension"];
  const excluded = excludedRoots.map((_, index) => String(987661 + index));
  for (let index = 0; index < excludedRoots.length; index++) {
    const directory = path.join(fixture, excludedRoots[index], "synthetic-output");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "synthetic.js"), `export const retainedClass = "z-[${excluded[index]}]";\n`);
  }
  // Keep non-React shared class helpers inside the declared web source boundary.
  await writeFile(path.join(fixture, "lib/classes.ts"), 'export const helper = "z-[987654]";\n');
  await writeFile(path.join(fixture, "shared/classes.ts"), 'export const shared = "z-[987655]";\n');

  // Positive control: the previous automatic root scan really reads these dot
  // directories. Their absence below cannot be explained by a vacuous fixture.
  const automatic = new Scanner({ sources: [{ base: fixture, pattern: "**/*", negated: false }] });
  const automaticCandidates = new Set(automatic.scan());
  for (const value of excluded) assert.ok(automaticCandidates.has(`z-[${value}]`), "Automatic scan must include synthetic excluded-root classes");

  const started = performance.now();
  const result = await postcss([tailwind({ base: fixture, optimize: true })]).process(
    await readFile(path.join(fixture, "app/globals.css"), "utf8"),
    { from: path.join(fixture, "app/globals.css"), map: false },
  );
  assert.equal(result.warnings().length, 0, "Authored CSS must compile without warnings");
  for (const selector of [".bg-paper-2", ".max-w-\\[960px\\]", ".sm\\:px-\\[30px\\]",
    ".bg-paid\\/12", ".hover\\:bg-primary\\/90", ".focus\\:border-seal"])
    assert.ok(result.css.includes(selector), `Real authored web utility missing: ${selector}`);
  let dialogAnimation = false;
  result.root.walkRules(rule => { if (rule.selector.includes("animate-in") && rule.selector.includes("state")) dialogAnimation = true; });
  assert.ok(dialogAnimation, "Imported tw-animate-css must still generate the dialog's state animation utility");
  const zIndexes = new Set();
  result.root.walkDecls("z-index", declaration => zIndexes.add(declaration.value));
  for (const value of ["987654", "987655"]) assert.ok(zIndexes.has(value), "Declared helper roots must produce utilities");
  for (const value of excluded) assert.ok(!zIndexes.has(value), "Retained/nonweb classes must not produce CSS");

  const dependencyPaths = result.messages.flatMap(message => message.type === "dependency" ? [message.file]
    : message.type === "dir-dependency" ? [message.dir] : []);
  for (const dependency of dependencyPaths) {
    const relative = path.relative(fixture, dependency).split(path.sep)[0];
    assert.ok(!excludedRoots.includes(relative), "Retained/nonweb roots must not enter the PostCSS dependency graph");
  }
  assert.ok(!result.messages.some(message => message.type === "dir-dependency"
    && path.resolve(message.dir) === fixture && message.glob === "**/*"), "Automatic root dependency must remain disabled");
  console.log(`PASS: installed Tailwind retains real web utilities and helper roots; excludes ${retained.length} retained-build and ${excludedRoots.length - retained.length} nonweb fixtures and dependencies (${Math.round(performance.now() - started)} ms).`);
} finally {
  // Unlink the dependency reference before recursive cleanup; never traverse the
  // real repository's node_modules or an existing retained release directory.
  if (linked) await unlink(modules);
  assert.equal(path.dirname(fixture), temporaryParent);
  assert.ok(path.basename(fixture).startsWith("keryx-tailwind-source-"));
  await rm(fixture, { recursive: true, force: true });
}
