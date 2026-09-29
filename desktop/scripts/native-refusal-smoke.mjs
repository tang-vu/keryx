/** Failure checks against a disposable downloaded package; never run on the release producer. */
import { _electron as electron } from "playwright";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyNativeWriterArtifact } from "../../lib/operator/native-writer-artifact.ts";

const app = process.argv[2] && resolve(process.argv[2]);
if (!app || process.platform !== "win32" || process.arch !== "x64") throw new Error("Expected downloaded Windows package directory");
const exe = join(app, "KeryxOperator.exe");
const native = join(app, "resources", "app", "dist", "native");
const binary = join(native, "keryx-engine.exe");
const manifestPath = join(native, "manifest.json");
const originalBinary = await readFile(binary);
const originalManifest = await readFile(manifestPath);
const sourceCommit = JSON.parse(originalManifest.toString("utf8")).sourceCommit;
const temp = await mkdtemp(join(tmpdir(), "keryx-native-refusal-"));
const workspace = join(temp, "workspace");
const userData = join(temp, "user-data");
const parent = join(temp, "parent");
await mkdir(workspace); await mkdir(userData); await mkdir(parent);
const request = { question: "Open existing offline research", budget: 0.01, researchMode: "quick",
  packageVersion: "1.0.0", responseMode: "async" };
const legacy = join(workspace, "legacy-task");
await mkdir(legacy);
await writeFile(join(legacy, "request.json"), JSON.stringify(request) + "\n");
await writeFile(join(legacy, "task.json"), JSON.stringify({ schema: "keryx-operator-task-v1", id: randomUUID(),
  createdAt: new Date().toISOString(), kind: "paid_research", request,
  payee: "0x1111111111111111111111111111111111111111", maxTotalMicros: "100000" }) + "\n");
await writeFile(join(userData, "workspace.json"), JSON.stringify({ path: workspace }));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ["systemroot", "windir", "userprofile", "appdata", "localappdata", "temp", "tmp", "comspec", "homedrive", "homepath", "pathext"]
    .includes(key.toLowerCase())));
environment.Path = [join(process.env.SystemRoot ?? "C:\\Windows", "System32"), process.env.SystemRoot ?? "C:\\Windows",
  join(process.env.SystemRoot ?? "C:\\Windows", "System32", "Wbem")].join(";");
environment.KERYX_DESKTOP_TEST_USER_DATA = userData;
environment.KERYX_DESKTOP_SMOKE_HIDDEN = "1";
let application;
let passed = false;
const createInput = { question: "Must not be created", mode: "quick", creatorBudget: "0.01",
  totalCap: "0.10", payee: "0x1111111111111111111111111111111111111111" };
async function treeDigest(root) {
  const digest = createHash("sha256");
  async function walk(path, relative) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      digest.update(name + "\0" + (entry.isDirectory() ? "d" : entry.isFile() ? "f" : "other") + "\0");
      if (entry.isDirectory()) await walk(join(path, entry.name), name);
      else if (entry.isFile()) digest.update(await readFile(join(path, entry.name)));
    }
  }
  await walk(root, "");
  return digest.digest("hex");
}
async function refusedWithoutMutation(page, label, expectedError) {
  const before = await treeDigest(workspace);
  const result = await page.evaluate(async input => {
    try { await window.keryxDesktop.createTask(input); return "accepted"; }
    catch (error) { return String(error); }
  }, createInput);
  if (result === "accepted" || !result.includes(expectedError)
    || !(await page.evaluate(async () => (await window.keryxDesktop.refresh()).tasks))
      .some(task => task.question === request.question) || await treeDigest(workspace) !== before) {
    throw new Error(`${label}: native refusal or offline legacy reopening failed`);
  }
}
try {
  application = await electron.launch({ executablePath: exe, cwd: app, env: environment, timeout: 30000 });
  const page = await application.firstWindow();
  await page.getByText("Open existing offline research", { exact: true }).first().waitFor();

  await rename(binary, `${binary}.missing`);
  try {
    await verifyNativeWriterArtifact(binary, manifestPath, sourceCommit).then(
      () => { throw new Error("Missing binary passed artifact verification"); },
      error => { if (error.code !== "ENOENT") throw error; });
    await refusedWithoutMutation(page, "missing binary", "trusted task writer is missing or its files changed");
    await application.evaluate(({ dialog }, parentPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parentPath] });
    }, parent);
    const result = await page.evaluate(async () => {
      try { await window.keryxDesktop.createWorkspace(); return "accepted"; }
      catch { return "refused"; }
    });
    if (result !== "refused" || (await readdir(parent)).length !== 0) {
      throw new Error("Missing binary permitted workspace creation");
    }
  } finally { await rename(`${binary}.missing`, binary); }

  const changed = Buffer.from(originalBinary);
  changed[0] ^= 1;
  await writeFile(binary, changed);
  try {
    await verifyNativeWriterArtifact(binary, manifestPath, sourceCommit).then(
      () => { throw new Error("Changed binary passed artifact verification"); },
      error => { if (!/does not match the trusted manifest/.test(String(error))) throw error; });
    await refusedWithoutMutation(page, "hash mismatch", "trusted task writer is missing or its files changed");
  }
  finally { await writeFile(binary, originalBinary); }

  const alternate = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe");
  await copyFile(alternate, binary);
  const replacement = await readFile(binary);
  const manifest = JSON.parse(originalManifest.toString("utf8"));
  manifest.sha256 = createHash("sha256").update(replacement).digest("hex");
  manifest.sizeBytes = (await stat(binary)).size;
  await writeFile(manifestPath, JSON.stringify(manifest) + "\n");
  try {
    await verifyNativeWriterArtifact(binary, manifestPath, sourceCommit);
    await refusedWithoutMutation(page, "protocol mismatch", "cannot use its task writer version");
  }
  finally { await writeFile(binary, originalBinary); await writeFile(manifestPath, originalManifest); }

  console.log(JSON.stringify({ packagedMissingBinaryRefusal: true, packagedHashMismatchRefusal: true,
    packagedProtocolMismatchRefusal: true, legacyReadyReopenWithoutWriter: true, noCreatedTask: true }));
  passed = true;
} finally {
  if (application) await application.close().catch(() => undefined);
  await writeFile(binary, originalBinary).catch(() => undefined);
  await writeFile(manifestPath, originalManifest).catch(() => undefined);
  if (passed) await rm(temp, { recursive: true, force: true });
  else console.error("Refusal smoke temp retained for diagnosis:", temp);
}
