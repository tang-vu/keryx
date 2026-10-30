import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractNamespaceCopy, validateNamespaceDraft } from "./check-ui-copy.mjs";
import { isNeutralResearchPreview } from "../lib/i18n/neutral-research-preview.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Same conservative boundary as the namespace preview validator. A preview never
// upgrades machine drafts into approved payment, privacy, consent or legal copy.
// Library bulk changes and cleared-data recovery require consent review as a whole.
const critical = /payment|consent|legal|privacy|terms|authoriz|signature|signing|settle|refund|withdraw|deposit|budget|spend|funding|sponsor|purchase|pay\b|paid\b|wallet|receipt|reserv|uncertain|pending|simulat|failed|expired|balance|transaction|obligation|toll|reward|payout|publication|publish|ownership|visibility|private|unlisted|erased|\bfees?\b|\bcap\b|literature-(?:bulk-screening|clear-recovery)/iu;
// Confirmation controls require review; educational prose mentioning confirmation does not.
const consentKey = /(?:^|[.])confirm(?:ation)?(?:[A-Z_]|$)|Confirm(?:ation)?$/u;
const read = file => readFileSync(path.join(root, file), "utf8");
// Agreed entry-preview floor. Missing namespaces or lost authored coverage must
// fail, even when somebody regenerates the compiled chunks after deleting text.
const entryPreviewMinimums = {
  "core-inline": { authored: 16, preview: 16 }, "get-started": { authored: 56, preview: 56 },
  "research-flow": { authored: 39, preview: 39 },
  "product-guide": { authored: 95, preview: 48 }, shell: { authored: 17, preview: 17 },
  reports: { authored: 55, preview: 54 }, "pdf-reading": { authored: 5, preview: 5 },
  "source-directory": { authored: 112, preview: 112 },
  // The conservative critical-copy filter retains the loadFailed status in English.
  "ui-preference": { authored: 9, preview: 8 },
};

export function generateUiPreviews(check = false) {
  const helpers = extractNamespaceCopy("locales/en/shared-helpers.ts", read("locales/en/shared-helpers.ts"));
  const resolve = expression => {
    const match = /^sharedHelperMessages\["([^\"]+)"\]$/.exec(expression);
    return match ? helpers.entries[match[1]] : undefined;
  };
  const files = readdirSync(path.join(root, "locales/en")).filter(file => /\.(?:ts|json|cjs)$/.test(file)).sort()
    .map(file => `locales/en/${file}`).concat("lib/i18n/messages.ts");
  const bindings = files.map(file => ({ namespace: file === "lib/i18n/messages.ts" ? "core-inline" : path.basename(file).replace(/\.[^.]+$/, ""),
    ...extractNamespaceCopy(file, read(file), resolve) }));
  const glossary = JSON.parse(read("locales/glossary/en.json"));
  const sharedNamespaces = new Set(["core-inline", ...[...read("lib/i18n/messages.ts")
    .matchAll(/from "\.\.\/\.\.\/locales\/en\/([^"/]+)"/g)].map(match => match[1])]);
  const digests = {};
  for (const locale of ["vi", "zh-Hans", "es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"]) {
    const namespaces = {}, messages = {};
    const inputs = [];
    const partial = !["vi", "zh-Hans"].includes(locale);
    const draftDirectory = path.join(root, `locales/${locale}/ui-drafts`);
    if (partial) for (const namespace of Object.keys(entryPreviewMinimums)) {
      if (!existsSync(path.join(draftDirectory, `${namespace}.json`))) throw Error(`${locale}: missing entry preview ${namespace}`);
    }
    const knownDrafts = new Set(bindings.map(binding => `${binding.namespace}.json`));
    for (const file of readdirSync(draftDirectory)) {
      if (file !== "manifest.json" && !knownDrafts.has(file)) throw Error(`${locale}: unknown draft namespace ${file}`);
    }
    for (const binding of bindings) {
      const draftPath = `locales/${locale}/ui-drafts/${binding.namespace}.json`;
      if (partial && !existsSync(path.join(root, draftPath))) continue;
      const draft = JSON.parse(read(draftPath));
      validateNamespaceDraft(draft, binding, glossary);
      inputs.push([binding.sourcePath, binding.sourceSha256,
        createHash("sha256").update(read(draftPath).replace(/\r\n?/g, "\n")).digest("hex")]);
      const entries = {};
      const ambiguous = new Set();
      let translatedKeys = 0;
      for (const [key, value] of Object.entries(draft.entries)) {
        if (!("text" in value) || key !== "previewNotice" &&
          (critical.test(`${binding.namespace} ${key} ${value.source}`) && !isNeutralResearchPreview(binding.namespace, key, value.source) || consentKey.test(key))) continue;
        // Resolve only exact, authored English templates; never match report data,
        // substrings, regular expressions or values interpolated into a template.
        if (entries[value.source] && entries[value.source] !== value.text) ambiguous.add(value.source);
        entries[value.source] = value.text;
        translatedKeys++;
        if (sharedNamespaces.has(binding.namespace)) messages[key] = value.text;
      }
      const minimum = entryPreviewMinimums[binding.namespace];
      if (partial && minimum && (Object.keys(draft.entries).length < minimum.authored || translatedKeys < minimum.preview)) {
        throw Error(`${locale}/${binding.namespace}: entry preview coverage fell below ${minimum.authored} authored/${minimum.preview} admitted keys`);
      }
      for (const source of ambiguous) delete entries[source];
      namespaces[binding.namespace] = entries;
    }
    // Shared message calls retain their exact key as well as their English
    // template. Equal English labels from unrelated areas must not collide.
    namespaces.$messages = messages;
    if (!inputs.length) throw Error(`${locale}: no preview drafts`);
    const digest = createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
    const output = `// Generated by scripts/generate-ui-previews.mjs. Machine drafts; no human approval.\n// Source and draft inputs: ${digest}\nconst preview: Record<string, Record<string, string>> = ${JSON.stringify(namespaces, null, 2)};\nexport default preview;\n`;
    const file = `locales/generated/${locale}-ui-preview.ts`;
    if (check) {
      if (read(file).replace(/\r\n?/g, "\n") !== output) throw Error(`${file} is stale; run node scripts/generate-ui-previews.mjs`);
    } else if (!existsSync(path.join(root, file)) || read(file).replace(/\r\n?/g, "\n") !== output) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), output);
    }
    if (partial) {
      const shellBinding = bindings.find(binding => binding.namespace === "shell");
      const shellDraft = JSON.parse(read(`locales/${locale}/ui-drafts/shell.json`));
      const shell = Object.fromEntries(Object.entries(shellDraft.entries).filter(([key, value]) =>
        /^shell(?:Navigation|Header|Footer)\./u.test(key) && "text" in value &&
        !critical.test(`shell ${key} ${value.source}`) && !consentKey.test(key)));
      validateNamespaceDraft(shellDraft, shellBinding, glossary);
      const shellOutput = `// Generated by scripts/generate-ui-previews.mjs. Machine draft; no human approval.\nimport type { ShellDraft } from "@/lib/i18n/ui-shell-catalogue";\nexport const uiShellPreview = ${JSON.stringify(shell, null, 2)} satisfies ShellDraft;\n`;
      const shellFile = `locales/${locale}/ui-shell-preview.ts`;
      if (check) {
        if (read(shellFile).replace(/\r\n?/g, "\n") !== shellOutput) throw Error(`${shellFile} is stale; regenerate UI previews`);
      } else if (!existsSync(path.join(root, shellFile)) || read(shellFile).replace(/\r\n?/g, "\n") !== shellOutput)
        writeFileSync(path.join(root, shellFile), shellOutput);
    }
    digests[locale] = digest;
  }
  return digests;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateUiPreviews(process.argv.includes("--check"));
  console.log("UI preview catalogues are bound to current English and draft inputs.");
}
