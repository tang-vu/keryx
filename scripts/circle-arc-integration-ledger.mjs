import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const START = "<!-- circle-arc-ledger:start -->";
const END = "<!-- circle-arc-ledger:end -->";
const HEADER = ["Tool", "What Keryx uses it for", "Code", "Network", "Status", "Proof", "Tracking"];
const STATUSES = new Set(["Live", "Testnet only", "Planned", "Not used"]);
const links = cell => [...cell.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

function markdownAnchors(markdown) {
  const anchors = new Set();
  const repeats = new Map();
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const boundary = /^\s*(`{3,}|~{3,})/.exec(line);
    if (boundary) {
      if (!fence) fence = boundary[1];
      else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    for (const match of line.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) anchors.add(match[1]);
    const heading = /^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (!heading) continue;
    const text = heading[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/<[^>]*>/g, "").replace(/[`*~]/g, "");
    const slug = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/g, "-");
    const occurrence = repeats.get(slug) ?? 0;
    repeats.set(slug, occurrence + 1);
    anchors.add(occurrence ? `${slug}-${occurrence}` : slug);
  }
  return anchors;
}

function checkLocalLink(href, { root, documentPath, markdown }) {
  const [file, fragment, extra] = href.split("#");
  if (extra !== undefined || /[?:]/.test(file) || file.includes("\\") || path.isAbsolute(file))
    throw new Error(`Invalid local code path: ${href}`);
  const target = file ? path.resolve(path.dirname(documentPath), file) : path.resolve(documentPath);
  if (!within(root, target)) throw new Error(`Code path escapes repository: ${href}`);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`Code file missing: ${href}`);
  if (!within(root, fs.realpathSync(target))) throw new Error(`Code symlink escapes repository: ${href}`);
  if (fragment !== undefined) {
    const content = target === path.resolve(documentPath) ? markdown : fs.readFileSync(target, "utf8");
    if (/\.md$/i.test(target)) {
      if (!markdownAnchors(content).has(fragment)) throw new Error(`Markdown anchor missing: ${href}`);
    } else {
      const line = /^L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(fragment);
      if (!line || Number(line[1]) > content.split(/\r?\n/).length ||
        (line[2] && (Number(line[2]) < Number(line[1]) || Number(line[2]) > content.split(/\r?\n/).length)))
        throw new Error(`Source line anchor missing: ${href}`);
    }
  }
}

/** Offline inventory validation; never opens proof URLs or loads application configuration. */
export function validateLedger(markdown, { repoRoot, documentPath }) {
  if (markdown.split(START).length !== 2 || markdown.split(END).length !== 2)
    throw new Error("Ledger must have exactly one start/end marker");
  const start = markdown.indexOf(START) + START.length;
  const end = markdown.indexOf(END);
  if (end < start) throw new Error("Ledger markers are reversed");
  const lines = markdown.slice(start, end).trim().split(/\r?\n/);
  const cells = line => {
    if (!line.startsWith("|") || !line.endsWith("|")) throw new Error("Malformed ledger table row");
    const values = line.slice(1, -1).split("|").map(value => value.trim());
    if (values.length !== HEADER.length) throw new Error("Ledger row must have seven columns");
    return values;
  };
  if (lines.length < 3 || JSON.stringify(cells(lines[0])) !== JSON.stringify(HEADER))
    throw new Error("Ledger header or rows missing");
  if (!cells(lines[1]).every(cell => /^:?-{3,}:?$/.test(cell))) throw new Error("Ledger separator missing");
  const root = fs.realpathSync(repoRoot);
  const options = { root, documentPath, markdown };
  const tools = new Set();
  let checkedPaths = 0;
  for (const line of lines.slice(2)) {
    const [tool, use, code, network, status, proof, tracking] = cells(line);
    if (!tool || tools.has(tool) || !use || !network) throw new Error(`Missing/duplicate inventory identity: ${tool}`);
    tools.add(tool);
    if (!STATUSES.has(status)) throw new Error(`Invalid status: ${tool}`);
    if (!links(tracking).some(url => /^https:\/\/github\.com\/tang-vu\/keryx\/issues\/[1-9]\d*$/.test(url)))
      throw new Error(`Tracking issue missing: ${tool}`);
    if (status === "Live" && !links(proof).some(url => {
      try { const parsed = new URL(url); return parsed.protocol === "https:" && Boolean(parsed.hostname); }
      catch { return false; }
    })) throw new Error(`Public HTTPS proof missing for Live row: ${tool}`);
    const codePaths = links(code);
    if (!codePaths.length && (code !== "—" || !["Planned", "Not used"].includes(status)))
      throw new Error(`Code links missing: ${tool}`);
    // Bare paths would escape validation; require every declared file to be a link.
    if (codePaths.length && code.replace(/\[[^\]]+\]\([^)]+\)/g, "").replace(/[\s,]/g, ""))
      throw new Error(`Unvalidated code text: ${tool}`);
    for (const href of codePaths) {
      if (!href.split("#")[0]) throw new Error(`Code links missing file: ${tool}`);
      checkLocalLink(href, options);
      checkedPaths++;
    }
  }
  // Also validate explanatory local links and anchors outside the inventory table.
  for (const href of new Set(links(markdown))) {
    if (/^https?:\/\//.test(href)) continue;
    checkLocalLink(href, options);
  }
  return { rows: tools.size, checkedPaths };
}

export function checkRepositoryLedger(repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const documentPath = path.join(repoRoot, "docs/engineering/circle-arc-integration-ledger.md");
  return validateLedger(fs.readFileSync(documentPath, "utf8"), { repoRoot, documentPath });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log("Circle/Arc ledger valid:", checkRepositoryLedger()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
