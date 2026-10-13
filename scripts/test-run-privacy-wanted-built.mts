/** #266 ordinary production Next warm/revoke regression. Synthetic SQLite/session only.
 * PRIMARY prerequisite: ONE successful fresh stock .next build of the reviewed combined
 * source, offline arcTestnet with no registry/credentials, in its reserved host slot.
 * Keep the existing build-context evidence (including these two raw caller hashes and
 * BUILD_ID). An arbitrary/old BUILD_ID, direct renderer tests, and immutable cache
 * configuration do not establish that prerequisite. Independent review must qualify
 * the supplied context; this script does not produce or certify a build receipt.
 * Run: node --import tsx scripts/test-run-privacy-wanted-built.mts <BUILD_ID> <build-context-file>
 * No build, providers, paid execution, shared DB, environment files or rollout.
 * Existing Playwright qualifies the actual captured 404 with same-build assets only.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, mkdtemp, open, opendir, readFile, readlink, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import type { QueryRun } from "../lib/types";
import type { PrivacyState, RunVisibility } from "../lib/run-privacy/contracts";
import type { Browser, BrowserServer, CDPSession } from "playwright";

const source = resolve(import.meta.dirname, ".."), script = join(source, "scripts/test-run-privacy-wanted-built.mts");
const publicOrigin = "https://keryx.cc", wallet = `0x${"a".repeat(40)}`, creator = `0x${"b".repeat(40)}`;
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const callerPins = {
  "app/wanted/[id]/page.tsx": "96479e98fa1e6dd2e39e574fc1835d90b883d38482295f2d8dc4d841d8f519d4",
  "app/wanted/[id]/opengraph-image.tsx": "89e3cad7705095e9b9048c330a14595032d34887ace9f3a83d85042cd59285b3",
};
async function checkCallers() {
  for (const [file, expected] of Object.entries(callerPins))
    assert.equal(sha(await readFile(join(source, file))), expected, `Requalify changed caller: ${file}`);
}
async function deadline<T>(work: Promise<T>, label: string, milliseconds = 60_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error(`${label}: deadline exceeded; preserve owned process for diagnosis, no kill/retry`)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}

// Only the owned application child uses this branch. Reusing the same fixture file
// gives ON/OFF separate immutable adapter lifetimes without a new launcher/service.
async function serve(fixture: string, expectedBuildId: string) {
  assert.equal(process.cwd(), fixture);
  assert.equal(process.env.NODE_ENV, "production");
  assert.equal(process.env.KERYX_NETWORK, "arcTestnet");
  assert.equal(process.env.NEXT_PUBLIC_KERYX_NETWORK, "arcTestnet");
  assert.equal(process.env.KERYX_FORCE_OFFLINE, "1");
  assert.equal((await readFile(join(fixture, ".next/BUILD_ID"), "utf8")).trim(), expectedBuildId);
  assert.ok(process.send, "Owned IPC lifecycle required");
  // Actual Next/application code is unchanged. No outbound socket is needed by
  // these renderers: local fonts/WASM are non-network reads. Reject even loopback
  // RPC/provider attempts here; only the parent's declared physical socket is used.
  const connect = Socket.prototype.connect;
  let deniedOutbound = 0;
  Socket.prototype.connect = function () {
    deniedOutbound++;
    throw Error("Wanted built fixture forbids application outbound network");
  } as typeof connect;
  const { startNextPublicServer } = await import("./next-public-server.mjs");
  const preparing = startNextPublicServer({ dir: fixture, port: 0, useBuildConfig: false });
  let closing = false;
  process.on("message", (message: unknown) => {
    if (!message || typeof message !== "object" || !("kind" in message) || message.kind !== "close" || closing) return;
    closing = true;
    void (async () => {
      const running = await preparing;
      await running.close(); // Existing HTTP drain -> app.close -> trace flush; no forced sockets/signals.
      await new Promise<void>((accept, reject) => process.send!({ kind: "closed", httpDrained: true,
        appClosed: true, deniedOutbound }, (error: Error | null) => error ? reject(error) : accept()));
      await new Promise<void>((accept, reject) => process.stdout.write("Wanted fixture owned app drained and closed\n",
        error => error ? reject(error) : accept()));
      await new Promise<void>((accept, reject) => process.stderr.write("", error => error ? reject(error) : accept()));
      // Like next-public-server's existing terminal shutdown, exit only after
      // positive close: instrumentation owns background intervals after app.close.
      // This is the child's graceful terminal exit, never a parent kill/destroy.
      process.disconnect();
      process.exit(0);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  });
  const running = await preparing;
  process.send!({ kind: "ready", ...running.receipt });
}

type Packet = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };
const text = (packet: Packet) => packet.body.toString("utf8");
function decode(value: string) {
  const entities: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&#39;": "'", "&#x27;": "'" };
  return value.replace(/&(?:amp|quot|lt|gt|#39|#x27);/g, entity => entities[entity]);
}
function attributes(tag: string) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));
}
function metadata(packet: Packet) {
  const html = text(packet), title = decode(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
  // Actual per-ID automatic image URLs necessarily differ for unknown/hidden.
  // Compare every text-bearing head meta value; compare served image bytes separately.
  const values = [...html.matchAll(/<meta\s[^>]*>/g)].map(match => attributes(match[0]))
    .filter(value => (value.name || value.property) && value.content !== undefined
      && !["og:image", "twitter:image"].includes(value.property ?? value.name))
    .map(value => [value.property ?? value.name, value.content]).sort((a, b) => a.join().localeCompare(b.join()));
  return { title, values };
}
function mainMarkup(packet: Packet) {
  const mains = [...text(packet).matchAll(/<main\b[\s\S]*?<\/main>/g)];
  assert.equal(mains.length, 1, "Actual compiled/served fallback must contain exactly one rendered main");
  return mains[0][0];
}
// Failure-only lexical structure for the existing bounded response; never log body/header values.
function missingMainStructure(packet: Packet, forbidden: string[]) {
  const html = text(packet), markup = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "<$1></$1>")
    .replace(/<!--[\s\S]*?-->/g, "");
  const count = (pattern: RegExp) => [...markup.matchAll(pattern)].length;
  const tagCounts = Object.fromEntries(["html", "head", "body", "main", "h1", "h2", "div", "p", "script", "style", "template"]
    .map(tag => [tag, count(new RegExp(`<${tag}(?=[\\s/>])`, "gi"))]));
  const templateDigests = { http404: 0, clientBailout: 0, other: 0, absent: 0 };
  for (const match of markup.matchAll(/<template\b[^>]*>/gi)) {
    const digest = attributes(match[0])["data-dgst"];
    const kind = digest === undefined ? "absent" : digest === "NEXT_HTTP_ERROR_FALLBACK;404" ? "http404"
      : digest === "BAILOUT_TO_CLIENT_SIDE_RENDERING" ? "clientBailout" : "other";
    templateDigests[kind]++;
  }
  const mediaType = String(packet.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  return {
    status: packet.status, contentType: ["text/html", "text/x-component", "image/png"].includes(mediaType)
      ? mediaType : mediaType ? "other" : "absent",
    bytes: packet.body.length, sha256: sha(packet.body), mainCount: tagCounts.main, tagCounts,
    markers: {
      public404Heading: count(/<h1\b[^>]*>\s*404\s*<\/h1>/gi) ? "present" : "absent",
      branded404Eyebrow: markup.includes("Dispatch № 404") ? "present" : "absent",
      nextFallbackHeading: count(/<h1\b[^>]*class="[^"]*\bnext-error-h1\b[^"]*"[^>]*>/gi) ? "present" : "absent",
      nextFallbackMessage: markup.includes("This page could not be found.") ? "present" : "absent",
    },
    templateDigests,
    // Counts follow the existing six synthetic forbidden markers; never emit their values.
    forbiddenPresenceCounts: forbidden.map(value => html.split(value).length - 1),
  };
}
function imageUrl(packet: Packet, gap: string) {
  const tag = [...text(packet).matchAll(/<meta\s[^>]*>/g)].map(match => attributes(match[0]))
    .find(value => value.property === "og:image");
  assert.ok(tag?.content, "PUBLIC must advertise the actual generated OG URL");
  const url = new URL(tag.content);
  assert.equal(url.origin, publicOrigin);
  assert.match(url.pathname, new RegExp(`^/wanted/${gap}/opengraph-image(?:/[A-Za-z0-9_-]+)?$`));
  assert.equal(url.hash, "");
  return url.pathname + url.search; // Retain the build's fixed query verbatim on every request.
}
function sameImageRoute(template: string, fromGap: string, toGap: string) {
  assert.ok(template.startsWith(`/wanted/${fromGap}/`));
  return template.replace(`/wanted/${fromGap}/`, `/wanted/${toGap}/`);
}

// Finite headroom over the retained prior fixture's observed ~813 MB/8,628
// entries/33 MB largest file and installed ~9.5 MB OG fonts. Future builds must
// qualify themselves; these limits do not certify them. Both roots share one cap.
const copyLimits = { entries: 20_000, fileBytes: 64 * 1024 * 1024, bytes: 2 * 1024 ** 3, depth: 24 };
type CopyEntry = { root: string; path: string; target: string; stats: Stats; digest?: string; stock?: StockLink;
  parents?: { root: string; path: string; stats: Stats }[] };
const copyIdentity = (stats: Stats) => [stats.dev, stats.ino, stats.mode, stats.nlink, stats.size, stats.mtimeMs, stats.ctimeMs];
async function ordinaryEntry(root: string, path: string) {
  const inside = relative(root, path);
  assert.ok(!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`), "Copy requires root/descendant containment");
  const stats = await lstat(path);
  assert.ok(!stats.isSymbolicLink() && (stats.isDirectory() || stats.isFile()), "Copy refuses links and special files");
  assert.equal(relative(root, await realpath(path)), inside, "Copy refuses real-path aliases/outward links");
  if (stats.isFile()) assert.equal(stats.nlink, 1, "Copy refuses hard-linked files");
  return stats;
}
// Only the three junctions observed in this successful stock build qualify.
// These are data pins, never imports or instructions from an installed package.
const stockWorktree = "D:/repos/server/Github/Hackathon/.keryx-worktrees/cli-run-privacy266-owner-controls-20261013";
const stockReceiptRoot = "D:/repos/server/Github/Hackathon/keryx/output/resume-distribution63-audit-20261012/privacy-current-stock-build-20261013";
const stockTrees = [
  ["@circle-fin/unified-balance-kit-0c69b7e99b232cac", "@circle-fin/unified-balance-kit", "e76cc780c5b065e00e36d70bef03ecbcfaa46200bbd71b752c5cf3871d733b46"],
  ["parse5-6a112f640792b72b", "parse5", "358e1f70abae9ee4693d9474df832ae286e358b2b1a603a88582b3e663132371"],
  ["pino-28069d5257187539", "pino", "e66ad4135110d235287159c0176fc6ac285941fdfb0efd9355cc8801f0475e5f"],
] as const;
type StockLink = { path: string; root: string; target: string; treeDigest: string; stats: Stats; linkText: string;
  parents: { root: string; path: string; stats: Stats }[]; inputs: CopyEntry[] };
async function checkStockEntry(entry: CopyEntry) {
  if (entry.stock) await checkStockLink(entry.stock);
  for (const parent of entry.parents ?? [])
    assert.deepEqual(copyIdentity(await ordinaryEntry(parent.root, parent.path)), copyIdentity(parent.stats), "Stock tree parent substituted");
  assert.deepEqual(copyIdentity(await ordinaryEntry(entry.root, entry.path)), copyIdentity(entry.stats), "Stock data path changed");
}
async function readCopyData(entry: CopyEntry) {
  assert.ok(entry.stats.isFile() && Number.isSafeInteger(entry.stats.size) && entry.stats.size >= 0
    && entry.stats.size <= copyLimits.fileBytes, "Stock data per-file bound");
  await checkStockEntry(entry);
  const file = await open(entry.path, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
  try {
    assert.deepEqual(copyIdentity(await file.stat()), copyIdentity(entry.stats), "Stock opened data changed");
    const buffer = Buffer.alloc(entry.stats.size + 1); let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    assert.equal(offset, entry.stats.size, "Stock data size changed");
    assert.deepEqual(copyIdentity(await file.stat()), copyIdentity(entry.stats), "Stock data changed while read");
    await checkStockEntry(entry);
    return buffer.subarray(0, offset);
  } finally { await file.close(); }
}
async function checkStockLink(stock: StockLink) {
  for (const parent of stock.parents)
    assert.deepEqual(copyIdentity(await ordinaryEntry(parent.root, parent.path)), copyIdentity(parent.stats), "Stock parent/root substituted");
  assert.deepEqual(copyIdentity(await lstat(stock.path)), copyIdentity(stock.stats), "Stock junction substituted");
  assert.equal(await readlink(stock.path), stock.linkText, "Stock junction target changed");
  assert.equal(await realpath(stock.path), stock.root, "Stock junction must target the exact own installed root");
}
async function checkStockAttributes(stocks: StockLink[], paths: string[]) {
  if (!stocks.length) return;
  assert.equal(process.platform, "win32"); assert.ok(process.env.SystemRoot);
  const records = [...stocks.map(stock => ({ path: stock.path, target: stock.root })),
    ...paths.map(path => ({ path, target: "" }))];
  assert.ok(records.every(record => !/[\r\n]/.test(record.path + record.target)));
  const check = spawn(join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      '$ErrorActionPreference="Stop"; while ($null -ne ($s=[Console]::In.ReadLine())) { $r=$s|ConvertFrom-Json; $i=Get-Item -Force -LiteralPath $r.path; if ($r.target) { if ($i.LinkType -cne "Junction" -or @($i.Target).Count -ne 1 -or $i.Target[0] -cne $r.target -or -not ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $i.PSIsContainer) { exit 1 } } elseif ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 1 } }; [Console]::Out.Write("stock-ordinary")'],
    { windowsHide: true, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR }, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = false, inputError = false;
  check.stdout.on("data", chunk => { output = (output + String(chunk)).slice(0, 32); });
  check.stderr.on("data", () => { errors = true; }); check.stdin.on("error", () => { inputError = true; });
  const closed = new Promise<void>((accept, reject) => {
    check.once("error", reject);
    check.once("close", (code, signal) => {
      try { assert.equal(code, 0); assert.equal(signal, null); assert.ok(!errors && !inputError && output === "stock-ordinary",
        "Stock copy requires exact native junctions and ordinary physical parents/trees"); accept(); } catch (error) { reject(error); }
    });
  });
  check.stdin.end(records.map(record => JSON.stringify(record)).join("\n") + "\n");
  await deadline(closed, "Owned stock junction attribute qualification");
}
async function qualifyStockLinks(dist: string, contextFile: string): Promise<StockLink[]> {
  assert.equal(source, resolve(stockWorktree)); assert.equal(resolve(dist), join(source, ".next"));
  assert.equal(resolve(contextFile), join(resolve(stockReceiptRoot), "exact-current-build-context.json"));
  const inputs: CopyEntry[] = [];
  for (const [path, digest] of [
    [resolve(contextFile), "da33d28b2cb58f69fefbd9d65b8f4cbc5790e37fa86af46ab0381a9cb9aca43e"],
    [join(stockReceiptRoot, "current-stock-build-result.json"), "95580c708ffaa4bd2bd280ab43a27e643da7d803772395658e9f8dffbafab39a"],
    [join(stockReceiptRoot, "dependency-copy-receipt.json"), "565d40e4a45ab104707976dbaab50d04ea4dcdef26013ad32f5cfe46df9047f4"],
    [join(dist, "required-server-files.json"), "aa9a57710a8d0a7e05538b71f94bae0468cd877ce30e4029840b37ca82cca44b"],
    [join(source, "node_modules/.package-lock.json"), "51c1a013590d79cd3a7377a9de3af7f8cffa5014b5ef007b729335561abecbfd"],
  ]) {
    const stats = await ordinaryEntry(dirname(path), path);
    assert.ok(stats.isFile() && stats.size <= 4 * 1024 * 1024, "Stock receipt/data bound");
    const entry = { root: dirname(path), path, target: "", stats, digest };
    assert.equal(sha(await readCopyData(entry)), digest, "Requalify changed actual stock build/dependency receipt"); inputs.push(entry);
  }
  const idPath = join(dist, "BUILD_ID"), idStats = await ordinaryEntry(dist, idPath);
  assert.ok(idStats.isFile() && idStats.size <= 128);
  const idEntry = { root: dist, path: idPath, target: "", stats: idStats };
  const id = await readCopyData(idEntry); assert.equal(id.toString("utf8").trim(), "cKFdNpGAOjmTPI-Gx_7iu");
  inputs.push({ ...idEntry, digest: sha(id) });
  const stocks: StockLink[] = [];
  for (const [name, installed, treeDigest] of stockTrees) {
    const path = join(dist, "node_modules", name), root = join(source, "node_modules", installed);
    const parents: StockLink["parents"] = [];
    for (const leaf of [dirname(path), root]) {
      const chain: string[] = []; let current = leaf;
      while (current !== source) {
        assert.ok(relative(source, current) && !relative(source, current).startsWith("..") && !isAbsolute(relative(source, current)));
        chain.unshift(current); current = dirname(current);
      }
      for (const parentPath of [source, ...chain]) if (!parents.some(parent => parent.path === parentPath)) {
        const stats = await ordinaryEntry(source, parentPath); assert.ok(stats.isDirectory());
        parents.push({ root: source, path: parentPath, stats });
      }
    }
    const stats = await lstat(path); assert.ok(stats.isSymbolicLink(), "Expected actual stock junction missing/substituted");
    const stock = { path, root, target: join(".next/node_modules", name), treeDigest, stats, linkText: await readlink(path), parents, inputs };
    await checkStockLink(stock); stocks.push(stock);
  }
  await checkStockAttributes(stocks, [...stocks.flatMap(stock => stock.parents.map(parent => parent.path)), ...inputs.map(input => input.path)]);
  return stocks;
}
async function qualifyCopies(dist: string, stocks: StockLink[] = []): Promise<CopyEntry[]> {
  const entries: CopyEntry[] = []; let visited = 0, bytes = 0;
  const seen = new Set<StockLink>();
  for (const [root, target, skipCache] of [[resolve(dist), ".next", true], [join(source, "app/fonts/og"), "app/fonts/og", false]] as const) {
    assert.equal(relative(root, await realpath(root)), "", "Copy requires an ordinary real root");
    const walk = async (path: string, destination: string, depth: number, physicalRoot = root, stock?: StockLink,
      parents: NonNullable<CopyEntry["parents"]> = []): Promise<void> => {
      assert.ok(++visited <= copyLimits.entries && depth <= copyLimits.depth && relative(root, path).length <= 1024,
        "Copy traversal/entry/depth bound exceeded");
      if (skipCache && path === join(root, "cache")) return; // Existing donor cache exclusion; never descend.
      const link = !stock && stocks.find(candidate => candidate.path === path);
      if (link) {
        assert.equal(destination, link.target); await checkStockLink(link); seen.add(link);
        await walk(link.root, destination, depth, link.root, link); return; // Ordinary physical DATA tree; never traverse the junction.
      }
      const stats = await ordinaryEntry(physicalRoot, path);
      if (depth === 0) assert.ok(stats.isDirectory(), "Copy root must be a directory");
      if (stats.isFile()) {
        assert.ok(Number.isSafeInteger(stats.size) && stats.size >= 0 && stats.size <= copyLimits.fileBytes,
          "Copy per-file byte bound exceeded");
        bytes += stats.size; assert.ok(bytes <= copyLimits.bytes, "Copy aggregate byte bound exceeded");
      }
      const entry: CopyEntry = { root: physicalRoot, path, target: destination, stats, ...(stock ? { stock, parents } : {}) };
      entries.push(entry);
      if (stats.isDirectory()) {
        const directory = await opendir(path, { bufferSize: 1 });
        for await (const child of directory) await walk(join(path, child.name), join(destination, child.name), depth + 1, physicalRoot, stock,
          stock ? [...parents, { root: physicalRoot, path, stats }] : parents);
      }
    };
    await walk(root, target, 0);
  }
  assert.equal(seen.size, stocks.length, "Every admitted stock junction must appear exactly in the built tree");
  // Node lstat covers symlinks/junctions; Windows also exposes non-link reparse
  // tags only through native attributes. One bounded literal metadata pass,
  // no recursion, shell-interpolated paths, foreign output, fallback or retry.
  if (process.platform === "win32") {
    assert.ok(process.env.SystemRoot, "Native Windows attribute qualification requires SystemRoot");
    assert.ok(entries.every(entry => !/[\r\n]/.test(entry.path)), "Copy refuses multiline paths");
    const check = spawn(join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        '$ErrorActionPreference="Stop"; while ($null -ne ($p=[Console]::In.ReadLine())) { if ((Get-Item -Force -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 1 } }; [Console]::Out.Write("ordinary")'],
      { windowsHide: true, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", errors = false, inputError = false;
    check.stdout.on("data", chunk => { output = (output + String(chunk)).slice(0, 32); });
    check.stderr.on("data", () => { errors = true; });
    check.stdin.on("error", () => { inputError = true; });
    const closed = new Promise<void>((accept, reject) => {
      check.once("error", reject);
      check.once("close", (code, signal) => {
        try { assert.equal(code, 0); assert.equal(signal, null); assert.ok(!errors && !inputError && output === "ordinary",
          "Copy requires positive native ordinary-entry attributes"); accept(); } catch (error) { reject(error); }
      });
    });
    check.stdin.end(entries.map(entry => entry.path).join("\n") + "\n");
    await deadline(closed, "Owned copy attribute qualification");
  }
  for (const stock of stocks) {
    const tree = entries.filter(entry => entry.stock === stock);
    for (const entry of tree) if (entry.stats.isFile()) entry.digest = sha(await readCopyData(entry));
    const rows = tree.map(entry =>
      `${relative(stock.root, entry.path).split(sep).join("/")}\t${entry.stats.isDirectory() ? "D" : "F"}\t${entry.stats.isDirectory() ? 0 : entry.stats.size}\t${entry.digest ?? ""}\n`);
    assert.ok(rows.every(row => row.split("\t").length === 4 && row.split("\n").length === 2), "Stock tree refuses ambiguous paths");
    assert.equal(sha(rows.sort().join("")), stock.treeDigest, "Installed stock tree substituted/changed"); await checkStockLink(stock);
  }
  return entries; // Internal paths/metadata only; no foreign donor values in a receipt.
}
async function copyQualified(entries: CopyEntry[], fixture: string) {
  assert.equal(relative(fixture, await realpath(fixture)), "", "Copy requires the validated own TEMP root");
  const stocks = [...new Set(entries.flatMap(entry => entry.stock ? [entry.stock] : []))];
  await checkStockAttributes(stocks, [...entries.filter(entry => entry.stock).map(entry => entry.path),
    ...stocks.flatMap(stock => stock.parents.map(parent => parent.path)), ...stocks.flatMap(stock => stock.inputs.map(input => input.path))]);
  for (const input of new Set(stocks.flatMap(stock => stock.inputs)))
    assert.equal(sha(await readCopyData(input)), input.digest, "Stock build/dependency input changed before copy");
  // Refuse a substituted target tree before any fixture entry is materialized;
  // retain per-entry/open-handle checks across the actual copy as well.
  for (const entry of entries) if (entry.stock) await checkStockEntry(entry);
  for (const entry of entries) {
    if (entry.stock) await checkStockEntry(entry);
    assert.deepEqual(copyIdentity(await ordinaryEntry(entry.root, entry.path)), copyIdentity(entry.stats), "Copy donor changed");
    const destination = join(fixture, entry.target);
    const inside = relative(fixture, destination);
    assert.ok(inside && !isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`), "Copy destination must remain in own TEMP");
    if (entry.stats.isDirectory()) { await mkdir(destination, { recursive: true }); continue; }
    const file = await open(entry.path, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
    try {
      assert.deepEqual(copyIdentity(await file.stat()), copyIdentity(entry.stats), "Copy opened donor changed");
      assert.deepEqual(copyIdentity(await ordinaryEntry(entry.root, entry.path)), copyIdentity(entry.stats), "Copy donor path changed after open");
      const buffer = Buffer.alloc(entry.stats.size + 1); let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      assert.equal(offset, entry.stats.size, "Copy donor size changed or exceeded bound");
      assert.deepEqual(copyIdentity(await file.stat()), copyIdentity(entry.stats), "Copy donor changed while read");
      if (entry.stock) {
        assert.equal(sha(buffer.subarray(0, offset)), entry.digest, "Stock donor bytes substituted");
        await checkStockEntry(entry);
      }
      await writeFile(destination, buffer.subarray(0, offset), { flag: "wx", mode: entry.stats.mode & 0o777 });
    } finally { await file.close(); }
  }
}

async function runMode(mode: "on" | "off", buildId: string, copies: CopyEntry[]) {
  const temporaryRoot = await realpath(tmpdir()), fixture = await mkdtemp(join(temporaryRoot, "keryx-wanted-built-"));
  assert.equal(dirname(resolve(fixture)), temporaryRoot);
  assert.ok(basename(fixture).startsWith("keryx-wanted-built-"));
  const nodeModulesLink = join(fixture, "node_modules"), database = join(fixture, "data/keryx.sqlite");
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA"])
    if (process.env[name]) environment[name] = process.env[name];
  Object.assign(environment, { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", BASE_URL: publicOrigin,
    KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
    KERYX_EXTERNAL_DISCOVERY: "0", KERYX_RPC_WS_URL: "", KERYX_REGISTRY_ADDRESS: "", NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: "",
    SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    KERYX_RUN_PRIVACY_ENABLED: mode === "on" ? "true" : "", JWT_SECRET: randomBytes(32).toString("hex") });
  // Sanitize the parent before loading source helpers, too. No .env file is read,
  // inherited runtime storage/archive/keys/claims/Operator/schedules or spend authority.
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, environment);
  const { SqliteAdapter } = await import("../lib/db/sqlite-adapter");
  const { RUN_PRIVACY_SQL } = await import("../lib/db/run-privacy-sqlite");
  const { writeSqliteQueryRun } = await import("../lib/db/query-run-record");
  const { issueWebSession } = await import("../lib/auth-session");
  const { demandGapId } = await import("../lib/demand-signal");
  let inspector: DatabaseSync | undefined, child: ReturnType<typeof spawn> | undefined, browser: Browser | undefined;
  let browserServer: BrowserServer | undefined, browserProcess: ReturnType<BrowserServer["process"]> | undefined;
  let browserCdp: CDPSession | undefined, browserStopped: Promise<void> | undefined, browserDisconnected: Promise<void> | undefined;
  let browserEndpoint: string | null = null;
  const browserLife = {
    launchRequested: false, serverBound: false, processBound: false, endpointBound: false, connected: false, cdpBound: false,
    pid: null as number | null, closeRequested: false, cdpSettled: false, closeAcknowledged: false,
    cdpError: null as string | null, cdpOutcomeQualified: false,
    exitSeen: false, exitCode: null as number | null, exitSignal: null as NodeJS.Signals | null,
    closeSeen: false, closeCode: null as number | null, closeSignal: null as NodeJS.Signals | null,
    serverClosed: false, disconnected: false, stdoutEOF: false, stderrEOF: false,
    processError: null as string | null, streamError: null as string | null, closureQualified: false, firstFalse: null as string | null,
  };
  const requireBrowser = (fact: unknown, name: string) => {
    if (!fact) browserLife.firstFalse ??= name;
    assert.ok(fact, `Owned Chromium qualification failed: ${name}; retain ownership, no kill/retry`);
  };
  const browserTerminalFacts = () => ({
    sameProcess: !!browserProcess && browserServer?.process() === browserProcess && browserProcess.pid === browserLife.pid,
    sameEndpoint: browserEndpoint !== null && browserServer?.wsEndpoint() === browserEndpoint,
    exitSeen: browserLife.exitSeen,
    naturalExit: browserLife.exitSeen && browserLife.exitCode === 0 && browserLife.exitSignal === null
      && browserProcess?.exitCode === 0 && browserProcess.signalCode === null,
    closeSeen: browserLife.closeSeen,
    naturalClose: browserLife.closeSeen && browserLife.closeCode === 0 && browserLife.closeSignal === null,
    stdoutEOF: browserLife.stdoutEOF, stderrEOF: browserLife.stderrEOF,
    serverClosed: browserLife.serverClosed, disconnected: browserLife.disconnected,
    notKilled: !!browserProcess && !browserProcess.killed,
    noProcessError: browserLife.processBound && browserLife.processError === null,
    noStreamError: browserLife.processBound && browserLife.streamError === null,
  });
  let stopped: Promise<void> | undefined, stdoutEOF = false, stderrEOF = false, childExit: unknown;
  let closedReceipt: { httpDrained: boolean; appClosed: boolean; deniedOutbound: number } | undefined;
  let exitSeen = false, clean = false, appLog = "";
  const ids = { target: "wanted-built-target", control: "wanted-built-control", retry: "wanted-built-retry", drift: "wanted-built-drift" };
  const marker = "WANTED266CONFIDENTIAL", question = `${marker} confidential astronomy question`;
  const claim = `${marker} spectral astronomy measurement`, controlClaim = "Metallic conductivity reference measurement";
  const driftClaim = "WANTED266UNAVAILABLE geothermal isotope measurement";
  const gap = demandGapId(claim), controlGap = demandGapId(controlClaim), driftGap = demandGapId(driftClaim), unknownGap = "0".repeat(64);
  const forbidden = [marker, question, claim, ids.target, `/dispatch/${ids.target}`, `/dispatch/${ids.retry}`];
  const observations: unknown[] = [];
  try {
    await mkdir(join(fixture, "data"));
    await copyNextConfigFixture(source, fixture);
    // Ordinary Next may write its normal cache/config/trace. Copy the completed
    // build into owned TEMP, never point a writable .next link at the donor.
    await copyQualified(copies, fixture);
    await symlink(join(source, "node_modules"), nodeModulesLink, process.platform === "win32" ? "junction" : "dir");
    assert.ok((await lstat(nodeModulesLink)).isSymbolicLink());
    assert.equal(await realpath(nodeModulesLink), await realpath(join(source, "node_modules")));
    const sqlite = new SqliteAdapter(database);
    let token: string;
    try {
      await sqlite.init();
      const setup = new DatabaseSync(database);
      try {
        setup.exec(RUN_PRIVACY_SQL); // Explicit source-known DDL on ONLY this synthetic TEMP DB.
        await sqlite.init();
        assert.equal(sqlite.runPrivacyActive, mode === "on");
        if (mode === "on") assert.ok(sqlite.runPrivacy);
        await sqlite.upsertSource({ id: "wanted-built-source", name: "Synthetic wanted creator", walletAddress: creator,
          authors: [], url: `${publicOrigin}/synthetic-wanted-source`, description: "Synthetic fixture; no acquisition",
          fetchPrice: 0, tags: [], createdAt: "2026-10-11T00:00:00.000Z", active: true });
        for (const [id, runQuestion, runClaim, hour] of [[ids.control, "Published control question", controlClaim, 0],
          [ids.retry, "Synthetic retry original", "", 1], [ids.target, question, claim, 2],
          [ids.drift, "WANTED266UNAVAILABLE confidential geothermal question", driftClaim, 3]] as const) {
          const run: QueryRun = { id, asker: wallet, createdAt: `2026-10-11T0${hour}:00:00.000Z`, origin: "web",
            question: runQuestion, answer: `Synthetic answer ${runQuestion}`, budget: 0.030001, engine: "heuristic",
            totalSpent: 0.012345, totalToCreators: 0.000001, subClaims: runClaim ? [runClaim] : [],
            decisions: [], trace: [], citations: [],
            claimCoverage: runClaim ? [{ claimIndex: 0, claim: runClaim, coverage: 0.1, coveredBy: [] }] : [] };
          writeSqliteQueryRun(setup, run, false);
        }
        const offer = setup.prepare(`INSERT INTO gap_intents
          (id,gap_id,claim,question,failed_query_id,source_id,source_item_link,owner_wallet,status,attempts,retry_run_id,coverage,reward_usdc,created_at,updated_at)
          VALUES(?,?,?,?,?,'wanted-built-source',?,?,'failed',1,?,0.1,0.000001,?,?)`);
        const time = "2026-10-11T04:00:00.000Z";
        offer.run("wanted-built-offer", gap, claim, question, ids.target, `${publicOrigin}/synthetic-target-offer`, creator, ids.retry, time, time);
        // An unaffected PUBLIC brief must lose only its withdrawn retry link.
        offer.run("wanted-built-control-offer", controlGap, controlClaim, "Published control question", ids.control,
          `${publicOrigin}/synthetic-control-offer`, creator, ids.target, time, time);
        token = (await issueWebSession(sqlite, environment.JWT_SECRET!, wallet, "asker")).token;
        for (const [index, status] of (["settled", "pending", "failed", "simulated"] as const).entries())
          await sqlite.recordPayment({ id: `wanted-built-${status}`, queryId: ids.target, kind: "citation",
            sourceId: "wanted-built-source", sourceName: "Synthetic wanted creator", payer: wallet, payee: creator,
            amountUsdc: (index + 1) / 1_000_000, network: "eip155:5042002", settled: status === "settled", settlementStatus: status,
            txHash: status === "settled" ? "synthetic-not-chain-evidence" : null,
            rationale: `${marker} synthetic journal rationale`, authorizationId: `synthetic-wanted-${status}-nonce`,
            grantEpoch: "synthetic-wanted-epoch", createdAt: time });
      } finally { setup.close(); }
    } finally { sqlite.close(); }
    inspector = new DatabaseSync(database);
    const db = inspector;
    const original = (id: string) => String(db.prepare("SELECT data FROM query_runs WHERE id=?").get(id)!.data);
    const originalTarget = original(ids.target), originalControl = original(ids.control), originalRetry = original(ids.retry), originalDrift = original(ids.drift);
    const finances = () => JSON.stringify({ journals: db.prepare("SELECT * FROM payment_events ORDER BY id").all(),
      counters: db.prepare("SELECT id,created_at,budget,engine,total_spent,total_to_creators,economics_data FROM query_runs ORDER BY id").all(),
      rewards: db.prepare("SELECT id,status,attempts,retry_run_id,coverage,reward_usdc FROM gap_intents ORDER BY id").all(),
      sources: db.prepare("SELECT * FROM sources ORDER BY id").all(), orders: db.prepare("SELECT * FROM a2a_orders ORDER BY id").all() });
    const before = finances();
    const unchanged = (erased = false) => {
      assert.equal(finances(), before, "Exact economics, journals and offer rewards must remain unchanged");
      assert.equal(original(ids.control), originalControl); assert.equal(original(ids.retry), originalRetry);
      assert.equal(original(ids.drift), originalDrift);
      if (!erased) assert.equal(original(ids.target), originalTarget, "Visibility must preserve stored original bytes");
    };
    child = spawn(process.execPath, ["--import", "tsx", script, "--serve", fixture, buildId],
      { cwd: fixture, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const ready = new Promise<number>((accept, reject) => {
      child!.once("error", reject);
      child!.once("exit", (code, signal) => { exitSeen = true; childExit = { code, signal }; reject(Error("Owned app exited before readiness")); });
      child!.on("message", (message: { kind: string; physicalPort?: number; publicOrigin?: string; physicalHost?: string;
        runtimeCache?: string; httpDrained: boolean; appClosed: boolean; deniedOutbound: number }) => {
        try {
          if (message.kind === "ready") {
            assert.equal(message.publicOrigin, publicOrigin); assert.equal(message.physicalHost, "127.0.0.1");
            assert.equal(message.runtimeCache, undefined, "Immutable/custom cache cannot qualify ordinary caching");
            assert.ok(message.physicalPort && message.physicalPort > 0); accept(message.physicalPort);
          } else if (message.kind === "closed") closedReceipt = message;
        } catch (error) { reject(error); }
      });
    });
    child.stdout!.on("data", chunk => { appLog = (appLog + String(chunk)).slice(-16_384); process.stdout.write(chunk); });
    child.stderr!.on("data", chunk => { appLog = (appLog + String(chunk)).slice(-16_384); process.stderr.write(chunk); });
    child.stdout!.once("end", () => { stdoutEOF = true; }); child.stderr!.once("end", () => { stderrEOF = true; });
    stopped = new Promise<void>(accept => child!.once("close", () => accept()));
    const port = await deadline(ready, "Owned ordinary Next readiness");
    const allowed = new Set<string>([...Object.values(ids).flatMap(id => [`/api/me/run-privacy/${id}`, `/api/me/run-privacy/${id}/export`]),
      ...[gap, controlGap, driftGap, unknownGap].flatMap(id => [`/wanted/${id}`, `/wanted/${id}?_rsc=`])]);
    const call = (path: string, method = "GET", owner = false, body?: unknown, extra: Record<string, string> = {}) => {
      assert.ok(allowed.has(path), `Undeclared request target: ${path}`);
      assert.ok(method === "GET" || owner && ["PATCH", "DELETE"].includes(method)
        && Object.values(ids).some(id => path === `/api/me/run-privacy/${id}`),
        "Only declared synthetic-owner privacy writes are allowed");
      const content = body === undefined ? undefined : JSON.stringify(body);
      return deadline(new Promise<Packet>((accept, reject) => {
        const outgoing = request({ hostname: "127.0.0.1", port, path, method, agent: false, headers: {
          Host: "keryx.cc", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "keryx.cc", "X-Forwarded-Port": "443",
          Connection: "close", "User-Agent": "Twitterbot", ...extra,
          ...(owner ? { Cookie: `keryx_session=${token}`, Origin: publicOrigin, "X-Keryx-Expected-Wallet": wallet } : {}),
          ...(content === undefined ? {} : { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(content)) }),
        } }, incoming => {
          const chunks: Buffer[] = []; let bytes = 0, failure: Error | undefined;
          incoming.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024) failure ??= Error("Response exceeded finite byte bound");
            else if (!failure) chunks.push(chunk);
          });
          incoming.on("error", reject);
          incoming.once("end", () => {
            if (failure) { reject(failure); return; }
            const packet = { status: incoming.statusCode!, headers: { ...incoming.headers }, body: Buffer.concat(chunks) };
            observations.push({ mode, port, method, path, rsc: extra.RSC === "1", status: packet.status, headers: packet.headers,
              bytes, sha256: sha(packet.body) });
            accept(packet);
          });
        });
        outgoing.once("error", reject); outgoing.end(content);
      }), `Owned request ${method} ${path}`, 15_000); // No redirect/retry/destroy/cache-busting.
    };
    // Setup publication also goes through the actual compiled owner HTTP handler.
    const mutate = async (id: string, visibility?: RunVisibility) => {
      assert.ok(Object.values(ids).includes(id));
      const owner = await call(`/api/me/run-privacy/${id}`, "GET", true); assert.equal(owner.status, 200);
      const state = (JSON.parse(text(owner)) as { state: PrivacyState }).state;
      const requestId = randomUUID(), input = { revision: state.revision, requestId, ...(visibility ? { visibility } : {}) };
      // Capture exact stored bytes, rather than reserializing an HTTP projection.
      const originalBefore = original(id);
      const packet = await call(`/api/me/run-privacy/${id}`, visibility ? "PATCH" : "DELETE", true, input);
      assert.equal(packet.status, 200); assert.match(String(packet.headers["cache-control"]), /no-store/);
      const result = { visibility: visibility ?? "private", revision: state.revision + 1, erased: visibility === undefined };
      assert.deepEqual(JSON.parse(text(packet)), result);
      const audit = db.prepare("SELECT wallet,run_id,action,input,result,original_digest FROM run_privacy_audit WHERE request_id=?").get(requestId)!;
      assert.equal(audit.wallet, wallet); assert.equal(audit.run_id, id); assert.equal(audit.action, visibility ? "visibility" : "erase");
      assert.deepEqual(JSON.parse(String(audit.input)), input); assert.deepEqual(JSON.parse(String(audit.result)), result);
      assert.equal(audit.original_digest, sha(originalBefore));
      return result;
    };
    const html = (id: string) => call(`/wanted/${id}`);
    // Next validates the empty hash for these absent router/prefetch headers; this URL stays fixed across warm/revoke.
    const flight = (id: string) => call(`/wanted/${id}?_rsc=`, "GET", false, undefined, { RSC: "1" });
    const png = async (path: string) => {
      allowed.add(path); const packet = await call(path); assert.equal(packet.status, 200);
      assert.match(String(packet.headers["content-type"]), /^image\/png/);
      assert.equal(packet.body.subarray(0, 8).toString("hex"), "89504e470d0a1a0a"); return sha(packet.body);
    };
    const noText = (packet: Packet, tokens = forbidden) => {
      for (const token of tokens) assert.ok(!text(packet).includes(token), `Withdrawn value in served bytes: ${token}`);
    };
    // The same-build static 404 supplies the complete branded subtree, not a
    // fabricated DOM or a string found in an unused Flight notFound prop.
    const compiled404 = await readFile(join(fixture, ".next/server/app/_not-found.html"));
    assert.ok(compiled404.length <= 2 * 1024 * 1024);
    const brandedMain = mainMarkup({ status: 404, headers: {}, body: compiled404 });
    assert.ok(brandedMain.includes("Dispatch \u2116 404") && brandedMain.includes("\u25c2 Return to the masthead"));
    const assets = new Map(copies.filter(entry => entry.stats.isFile()).flatMap(entry => {
      const path = entry.target.split(sep).join("/");
      return path.startsWith(".next/static/") && /\.(?:js|css|woff2)$/.test(path)
        ? [[`/_next/static/${path.slice(".next/static/".length)}`, join(fixture, entry.target)] as const] : [];
    }));
    const guestReads = new Set(["/api/auth/session", "/maintenance/status"]);
    const servedMain = async (packet: Packet, id: string) => {
      assert.equal(packet.status, 404); assert.match(String(packet.headers["content-type"]), /^text\/html/);
      noText(packet);
      if (!browser) {
        const { chromium } = await import("playwright");
        browserLife.launchRequested = true;
        browserServer = await chromium.launchServer({ headless: true, host: "127.0.0.1",
          handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
        browserLife.serverBound = true;
        const owned = browserProcess = browserServer.process();
        browserLife.pid = owned.pid ?? null;
        owned.once("exit", (code, signal) => {
          browserLife.exitSeen = true; browserLife.exitCode = code; browserLife.exitSignal = signal;
          if (!browserLife.closeRequested) browserLife.firstFalse ??= "exitBeforeCloseRequest";
        });
        browserStopped = new Promise<void>(accept => owned.once("close", (code, signal) => {
          browserLife.closeSeen = true; browserLife.closeCode = code; browserLife.closeSignal = signal; accept();
        }));
        owned.once("error", error => { browserLife.processError = error.message; browserLife.firstFalse ??= "processError"; });
        browserServer.once("close", () => { browserLife.serverClosed = true; });
        requireBrowser(owned.stdout && owned.stderr, "separateBrowserPipes");
        owned.stdout!.once("end", () => { browserLife.stdoutEOF = true; });
        owned.stderr!.once("end", () => { browserLife.stderrEOF = true; });
        for (const stream of [owned.stdout!, owned.stderr!]) stream.once("error", error => {
          browserLife.streamError ??= error.message; browserLife.firstFalse ??= "streamError";
        });
        requireBrowser(Number.isSafeInteger(owned.pid) && owned.pid! > 0 && owned !== child && owned.pid !== child?.pid,
          "distinctOwnedBrowserProcess");
        requireBrowser(owned.exitCode === null && owned.signalCode === null && !owned.killed
          && !owned.stdout!.readableEnded && !owned.stderr!.readableEnded && !owned.stdout!.destroyed && !owned.stderr!.destroyed,
          "liveBrowserAtBinding");
        browserLife.processBound = true;
        const endpoint = browserServer.wsEndpoint(), address = new URL(endpoint);
        requireBrowser(address.protocol === "ws:" && address.hostname === "127.0.0.1" && Number(address.port) > 0
          && !address.username && !address.password && !address.search && !address.hash && address.pathname.length > 1,
          "exactOwnedLoopbackEndpoint");
        browserEndpoint = endpoint; browserLife.endpointBound = true;
        browser = await chromium.connect(endpoint, { timeout: 15_000 });
        browserDisconnected = new Promise<void>(accept => browser!.once("disconnected", () => {
          browserLife.disconnected = true;
          if (!browserLife.closeRequested) browserLife.firstFalse ??= "disconnectBeforeCloseRequest";
          accept();
        }));
        requireBrowser(browser.isConnected() && !browserLife.exitSeen && !browserLife.closeSeen && !browserLife.serverClosed
          && !browserLife.stdoutEOF && !browserLife.stderrEOF && browserLife.firstFalse === null, "liveOwnedBrowserConnection");
        browserLife.connected = true;
        browserCdp = await deadline(browser.newBrowserCDPSession(), "Owned intrinsic Chromium CDP binding", 15_000);
        browserLife.cdpBound = true;
      }
      const context = await browser.newContext({ serviceWorkers: "block", locale: "en-US" });
      const documentPath = `/wanted/${id}`, tasks: Promise<void>[] = [];
      const denied = { origin: 0, write: 0, otherGet: 0, websocket: 0 };
      let failure: unknown, documents = 0, assetResponses = 0, guestResponses = 0, pageErrors = 0;
      let main: string;
      const fulfill = async (route: import("playwright").Route, value: Packet) => {
        // Preserve the real status, CSP and response bytes. Only hop-by-hop and
        // original wire-length headers are omitted from Playwright's transport.
        const headers = Object.fromEntries(Object.entries(value.headers).flatMap(([name, value]) =>
          value === undefined || ["connection", "keep-alive", "transfer-encoding", "content-length"].includes(name)
            ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]]));
        await route.fulfill({ status: value.status, headers, body: value.body });
      };
      try {
        await context.routeWebSocket("**/*", async socket => { denied.websocket++; await socket.close(); });
        await context.route("**/*", route => {
          const work = (async () => {
            assert.ok(tasks.length < 256, "Finite captured-document resource bound");
            const req = route.request(), url = new URL(req.url()), path = url.pathname + url.search;
            if (url.origin !== publicOrigin) { denied.origin++; await route.abort(); return; }
            if (req.method() !== "GET") { denied.write++; await route.abort(); return; }
            if (req.isNavigationRequest() && req.resourceType() === "document" && path === documentPath) {
              assert.equal(++documents, 1, "Consume this exact served 404 once; no second page GET");
              await fulfill(route, packet); return;
            }
            const asset = assets.get(path);
            if (!asset && !guestReads.has(path)) { denied.otherGet++; await route.abort(); return; }
            // No route.fetch/continue: every admitted GET uses ONLY the existing
            // physical listener/public-metadata transport, without owner cookies.
            allowed.add(path);
            const response = await call(path);
            assert.equal(response.headers["set-cookie"], undefined);
            if (asset) {
              assert.equal(response.status, 200);
              assert.deepEqual(response.body, await readFile(asset), "Execute exact copied compiled asset bytes");
              assetResponses++;
            } else {
              assert.equal(response.status, path === "/api/auth/session" ? 401 : 404);
              guestResponses++;
            }
            noText(response); await fulfill(route, response);
          })().catch(async error => { failure ??= error; await route.abort().catch(() => undefined); });
          tasks.push(work); return work;
        });
        const page = await context.newPage();
        page.on("pageerror", () => { pageErrors++; });
        const response = await page.goto(publicOrigin + documentPath, { waitUntil: "load", timeout: 15_000 });
        assert.ok(response); assert.equal(response.status(), packet.status);
        assert.deepEqual(await response.body(), packet.body, "DOM must consume the exact captured ordinary 404");
        await page.locator("main").waitFor({ state: "visible", timeout: 15_000 });
        assert.equal(await page.locator("main").count(), 1);
        main = await page.locator("main").evaluate(element => element.outerHTML);
        assert.equal(main, brandedMain, "Full served DOM must equal this build's complete branded 404 main");
        const dom = Buffer.from(await page.content()); assert.ok(dom.length <= 2 * 1024 * 1024);
        noText({ ...packet, body: dom });
        await Promise.all(tasks); assert.equal(failure, undefined); assert.equal(pageErrors, 0);
        assert.equal(documents, 1); assert.ok(assetResponses > 0, "Real compiled browser assets required");
      } catch (error) {
        console.error(JSON.stringify({ kind: "wanted-served-main-unqualified", structure: missingMainStructure(packet, forbidden),
          documents, assetResponses, guestResponses, pageErrors, denied }));
        throw error;
      } finally {
        await context.close(); await Promise.all(tasks); // All admitted physical GET bodies reach EOF before app closure.
      }
      assert.equal(failure, undefined);
      observations.push({ kind: "wanted-served-fallback-dom", mode, buildId, path: documentPath,
        servedBodySha256: sha(packet.body), mainSha256: sha(main), documents, assetResponses, guestResponses, denied });
      return main;
    };
    const pair = async (id: string) => {
      const page = await html(id), rsc = await flight(id);
      assert.match(String(rsc.headers["content-type"]), /^text\/x-component/);
      return { page, rsc };
    };
    if (mode === "on") { await mutate(ids.control, "public"); await mutate(ids.retry, "public"); }
    const control = await pair(controlGap); assert.equal(control.page.status, 200); assert.equal(control.rsc.status, 200);
    assert.ok(text(control.page).includes(controlClaim)); assert.ok(text(control.rsc).includes(controlClaim));
    const controlImage = imageUrl(control.page, controlGap), controlPng = await png(controlImage);
    const targetImage = sameImageRoute(controlImage, controlGap, gap), unknownImage = sameImageRoute(controlImage, controlGap, unknownGap);
    const unknown = await pair(unknownGap); assert.equal(unknown.page.status, 404);
    assert.ok([200, 404].includes(unknown.rsc.status), "Flight may emit its generic fallback after streaming starts");
    assert.ok(text(unknown.rsc).includes('"404"'), "Actual Flight unknown fallback required");
    const genericPng = await png(unknownImage);
    const unknownMain = await servedMain(unknown.page, unknownGap);
    const hidden = async () => {
      const current = await pair(gap);
      if ([current.page, unknown.page].some(packet => !/<main\b[\s\S]*?<\/main>/.test(text(packet))))
        console.error(JSON.stringify({ kind: "wanted-missing-main-structure",
          hidden: missingMainStructure(current.page, forbidden), unknown: missingMainStructure(unknown.page, forbidden) }));
      noText(current.page); noText(current.rsc);
      assert.equal(current.page.status, unknown.page.status); assert.equal(current.rsc.status, unknown.rsc.status);
      assert.deepEqual(metadata(current.page), metadata(unknown.page)); assert.equal(await servedMain(current.page, gap), unknownMain);
      assert.ok(text(current.rsc).includes('"404"')); assert.equal(await png(targetImage), genericPng);
      const unaffected = await pair(controlGap); assert.equal(unaffected.page.status, 200); assert.equal(unaffected.rsc.status, 200);
      assert.ok(text(unaffected.page).includes(controlClaim)); assert.ok(text(unaffected.rsc).includes(controlClaim));
      noText(unaffected.page); noText(unaffected.rsc); assert.equal(await png(controlImage), controlPng);
    };
    const warm = async () => {
      const current = await pair(gap); assert.equal(current.page.status, 200); assert.equal(current.rsc.status, 200);
      for (const packet of [current.page, current.rsc])
        for (const token of [claim, `/dispatch/${ids.target}`, `/dispatch/${ids.retry}`]) assert.ok(text(packet).includes(token));
      assert.ok(metadata(current.page).title.includes(claim)); assert.equal(imageUrl(current.page, gap), targetImage);
      assert.notEqual(await png(targetImage), genericPng);
      const unaffected = await pair(controlGap); assert.ok(text(unaffected.page).includes(`/dispatch/${ids.target}`));
      assert.ok(text(unaffected.rsc).includes(`/dispatch/${ids.target}`));
      // Warm each identical URL twice, including its actual image and RSC variant.
      const again = await pair(gap); assert.equal(again.page.status, 200); assert.equal(again.rsc.status, 200);
      assert.ok(text(again.page).includes(claim)); assert.ok(text(again.rsc).includes(claim));
      assert.notEqual(await png(targetImage), genericPng);
    };
    if (mode === "off") {
      await warm(); // Private sidecar is deliberately ignored by the ordinary OFF reader.
      const state = db.prepare("SELECT visibility FROM run_privacy WHERE run_id=?").get(ids.target)!;
      assert.equal(state.visibility, "private");
      const refusal = await call(`/api/me/run-privacy/${ids.target}`, "PATCH", true,
        { visibility: "public", revision: 0, requestId: randomUUID() });
      assert.equal(refusal.status, 503); assert.deepEqual(JSON.parse(text(refusal)), { error: "privacy_unavailable" });
      assert.equal(db.prepare("SELECT count(*) n FROM run_privacy_audit").get()!.n, 0); unchanged();
    } else {
      await hidden();
      for (const visibility of ["unlisted", "private"] as const) {
        await mutate(ids.target, "public"); await warm(); unchanged();
        await mutate(ids.target, visibility); await hidden(); unchanged();
      }
      await mutate(ids.target, "public"); await warm();
      const exportId = randomUUID();
      const exported = await call(`/api/me/run-privacy/${ids.target}/export`, "GET", true, undefined, { "X-Keryx-Request-Id": exportId });
      assert.equal(exported.status, 200); assert.deepEqual(JSON.parse(text(exported)).run, JSON.parse(originalTarget));
      const exportAudit = db.prepare("SELECT action,original_digest FROM run_privacy_audit WHERE request_id=?").get(exportId)!;
      assert.equal(exportAudit.action, "export"); assert.equal(exportAudit.original_digest, sha(originalTarget));
      await mutate(ids.target); await hidden(); unchanged(true);
      const erased = db.prepare("SELECT question,answer,data FROM query_runs WHERE id=?").get(ids.target)!;
      assert.equal(erased.question, ""); assert.equal(erased.answer, ""); assert.ok(!String(erased.data).includes(marker));
      // Independent warm PUBLIC -> trigger drift, restore source-known trigger,
      // then rewarm PUBLIC -> unavailable privacy relation. Same process/URLs.
      await mutate(ids.drift, "public");
      const driftImage = sameImageRoute(controlImage, controlGap, driftGap);
      const driftTokens = ["WANTED266UNAVAILABLE", driftClaim, ids.drift, `/dispatch/${ids.drift}`];
      const warmDrift = async () => {
        const current = await pair(driftGap); assert.equal(current.page.status, 200); assert.equal(current.rsc.status, 200);
        assert.ok(text(current.page).includes(driftClaim)); assert.ok(text(current.rsc).includes(driftClaim));
        assert.equal(imageUrl(current.page, driftGap), driftImage); assert.notEqual(await png(driftImage), genericPng);
      };
      const unavailable = async () => {
        const current = await pair(driftGap), absent = await pair(unknownGap);
        assert.equal(current.page.status, 500); assert.equal(absent.page.status, 500);
        assert.equal(current.rsc.status, absent.rsc.status);
        for (const packet of [current.rsc, absent.rsc]) {
          assert.ok([200, 500].includes(packet.status));
          assert.match(text(packet), /:E\{[^\n]*"digest":/, "Actual Flight error required, never a stale successful render");
        }
        for (const packet of [current.page, current.rsc, absent.page, absent.rsc]) { noText(packet, driftTokens); noText(packet); }
        assert.deepEqual(metadata(current.page), metadata(absent.page));
        assert.equal(await png(driftImage), genericPng); assert.equal(await png(unknownImage), genericPng); unchanged(true);
      };
      const trigger = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='run_privacy_new'").get()!.sql);
      await warmDrift(); db.exec("DROP TRIGGER run_privacy_new"); await unavailable();
      db.exec(trigger); await warmDrift();
      db.exec("ALTER TABLE run_privacy RENAME TO wanted_fixture_unavailable"); await unavailable();
    }
    console.log(JSON.stringify({ mode, buildId, port, fixture, syntheticOnly: true, observations, assertionsPassed: true }));
  } finally {
    try {
      if (browserLife.launchRequested) {
        try {
          requireBrowser(browserServer && browserProcess && browserStopped && browserDisconnected && browserCdp
            && browserLife.serverBound && browserLife.processBound && browserLife.endpointBound && browserLife.connected
            && browserLife.cdpBound, "boundBrowserOwnership");
          requireBrowser(browserServer!.process() === browserProcess && browserProcess!.pid === browserLife.pid
            && browserServer!.wsEndpoint() === browserEndpoint, "sameLiveBrowserOwnership");
          requireBrowser(browser!.isConnected() && browserProcess!.exitCode === null && browserProcess!.signalCode === null
            && !browserProcess!.killed && !browserLife.exitSeen && !browserLife.closeSeen && !browserLife.serverClosed
            && !browserLife.disconnected && !browserLife.stdoutEOF && !browserLife.stderrEOF
            && !browserProcess!.stdout!.readableEnded && !browserProcess!.stderr!.readableEnded
            && !browserProcess!.stdout!.destroyed && !browserProcess!.stderr!.destroyed
            && browserLife.firstFalse === null, "liveBrowserBeforeCloseRequest");
          requireBrowser(browser!.contexts().length === 0 && !browserLife.closeRequested, "drainedContextsAndSingleCloseRequest");
          browserLife.closeRequested = true;
          // Intrinsic CDP send has no process-close/kill fallback in the pinned vendor.
          // Its acknowledgement or disconnection is never a process exit receipt.
          const closing = browserCdp!.send("Browser.close").then(() => {
            browserLife.cdpSettled = true; browserLife.closeAcknowledged = true; return { ok: true as const };
          }, (error: unknown) => {
            browserLife.cdpSettled = true;
            browserLife.cdpError = error instanceof Error ? error.message.split("\n")[0] : "non-Error rejection";
            return { ok: false as const, error };
          });
          const [, , outcome] = await deadline(Promise.all([browserStopped!, browserDisconnected!, closing]),
            "Owned Chromium process/stdio graceful closure", 30_000);
          for (const [name, fact] of Object.entries(browserTerminalFacts())) requireBrowser(fact, name);
          // Pinned Playwright rejects pending sends when the owned transport closes.
          // Only that closure error, AFTER positive same-process exit/close/EOF, qualifies.
          if (!outcome.ok) requireBrowser(outcome.error instanceof Error
            && /^cdpSession\.send: (?:Target page, context or browser has been closed|Browser closed)(?:\n|$)/.test(outcome.error.message),
            "expectedPendingCdpClosureError");
          browserLife.cdpOutcomeQualified = true; browserLife.closureQualified = true;
          console.log(JSON.stringify({ kind: "wanted-owned-browser-closed", mode, buildId, browser: browserLife }));
        } catch (error) {
          browserLife.firstFalse ??= Object.entries({ serverBound: browserLife.serverBound, processBound: browserLife.processBound,
            endpointBound: browserLife.endpointBound, connected: browserLife.connected, cdpBound: browserLife.cdpBound,
            closeRequested: browserLife.closeRequested, ...browserTerminalFacts(), cdpSettled: browserLife.cdpSettled,
            cdpOutcomeQualified: browserLife.cdpOutcomeQualified }).find(([, fact]) => !fact)?.[0] ?? "browserClosureFailure";
          console.error(JSON.stringify({ kind: "wanted-owned-browser-unqualified", mode, buildId, fixture, browser: browserLife,
            terminalFacts: browserTerminalFacts(), failure: error instanceof Error ? error.message : "non-Error failure",
            app: { pid: child?.pid ?? null, exitSeen, childExit: childExit ?? null, stdoutEOF, stderrEOF,
              closedReceipt: closedReceipt ?? null }, preserveOwned: true }));
          // A fatal top-level rejection invokes Playwright's unconditional exit kill hook.
          // This failed run stays pending with its ownership; late exit cannot qualify it.
          process.exitCode = 1;
          await new Promise<never>(() => {});
        }
      }
      if (child && stopped) {
        if (!exitSeen && child.connected) await new Promise<void>((accept, reject) =>
          child!.send({ kind: "close" }, error => error ? reject(error) : accept()));
        await deadline(stopped, "Owned app/stdio graceful closure");
        assert.deepEqual(childExit, { code: 0, signal: null });
        assert.ok(closedReceipt?.httpDrained && closedReceipt.appClosed, `Missing positive owned close: ${appLog}`);
        assert.equal(closedReceipt.deniedOutbound, 0, "No hidden provider/RPC/network attempt may pass");
        assert.ok(stdoutEOF && stderrEOF, "Record actual separate child stream EOF");
        console.log(JSON.stringify({ mode, childExit, stdoutEOF, stderrEOF, ...closedReceipt }));
      }
      clean = true;
    } finally {
      inspector?.close();
      if (clean) {
        assert.equal(dirname(await realpath(fixture)), temporaryRoot);
        assert.ok(basename(fixture).startsWith("keryx-wanted-built-"));
        if (await lstat(nodeModulesLink).catch(() => undefined)) await unlink(nodeModulesLink);
        await rm(fixture, { recursive: true }); // Only the verified owned TEMP tree, after positive app closure.
      } else console.error(`Retain owned TEMP/process for diagnosis: ${fixture}; no forced cleanup`);
    }
  }
}

async function main() {
  const [buildId, contextFile, ...extra] = process.argv.slice(2);
  assert.ok(buildId && /^[A-Za-z0-9_-]{1,128}$/.test(buildId) && contextFile && extra.length === 0,
    "Required: reviewed current BUILD_ID and existing PRIMARY exact-source build-context file");
  assert.equal(process.env.NEXT_DIST_DIR, undefined, "Use the reviewed stock .next build/config");
  const dist = join(source, ".next");
  await checkCallers();
  assert.equal((await readFile(join(dist, "BUILD_ID"), "utf8")).trim(), buildId);
  const context = await readFile(resolve(contextFile)); assert.ok(context.length > 0 && context.length <= 4 * 1024 * 1024);
  for (const pin of [buildId, ...Object.values(callerPins)]) assert.ok(context.toString("utf8").includes(pin),
    "PRIMARY context must explicitly bind the actual successful build and both changed caller bytes; old pgPw evidence is insufficient");
  const required = JSON.parse(await readFile(join(dist, "required-server-files.json"), "utf8"));
  assert.equal(required.version, 1); assert.equal(required.config.distDir, ".next");
  assert.ok(!required.config.cacheComponents && !required.config.cacheHandler && !required.config.images?.customCacheHandler,
    "Ordinary Next caches required; immutable/useBuildConfig/custom-cache evidence is inapplicable");
  assert.ok(!["export", "standalone"].includes(required.config.output));
  const inputPins: Record<string, string> = { ...callerPins };
  for (const file of ["next.config.ts", "package.json", "package-lock.json", "scripts/next-public-server.mjs",
    "scripts/test-private-bibliography-built.mts", "test-support/next-config-fixture.ts", "lib/db/run-privacy-sqlite.ts",
    "lib/db/query-run-record.ts", "lib/auth-session.ts", "scripts/test-run-privacy-wanted-built.mts"])
    inputPins[file] = sha(await readFile(join(source, file)));
  console.log(JSON.stringify({ buildId, primaryBuildContext: resolve(contextFile), primaryBuildContextSha256: sha(context), inputPins,
    buildManifestSha256: sha(await readFile(join(dist, "required-server-files.json"))),
    compileQualification: "PRIMARY separately qualifies successful exact combined-source build; context string checks alone are not compiler provenance",
    profile: "synthetic ordinary offline arcTestnet; physical loopback/public HTTPS metadata; default OFF unchanged" }));
  const copies = await qualifyCopies(dist, await qualifyStockLinks(dist, resolve(contextFile))); // One bounded inventory for both modes; same actual build.
  await runMode("on", buildId, copies); await runMode("off", buildId, copies);
  await checkCallers(); assert.equal((await readFile(join(dist, "BUILD_ID"), "utf8")).trim(), buildId);
  console.log("Built wanted ordinary cache regression passed: fixed warm URLs, owner HTTP unlist/private/erase, audit/export/economics, unavailable/drift, captured 404 compiled DOM, separate OFF and graceful owned app exits. No production/PG/CDN/rollout acceptance.");
}

if (process.argv[2] === "--serve") {
  assert.equal(process.argv.length, 5); await serve(resolve(process.argv[3]), process.argv[4]);
} else await main();
