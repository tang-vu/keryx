import { readFile, mkdir, copyFile, mkdtemp, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

// Assemble only Next's traced /api/ask runtime. Children cannot reach the repository's modules
// through NODE_PATH, cwd or inherited environment. This catches absent runtime worker assets.
const root = process.cwd();
const tracePath = path.join(root, process.env.NEXT_DIST_DIR || ".next", "server/app/api/ask/route.js.nft.json");
const trace = JSON.parse(await readFile(tracePath, "utf8"));
const assembled = await mkdtemp(path.join(tmpdir(), "keryx-readers-"));
try {
  for (const entry of trace.files) {
    const source = path.resolve(path.dirname(tracePath), entry), relative = path.relative(root, source);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Trace escaped application root");
    const target = path.join(assembled, relative);
    // Turbopack records external-package directory links too; their individual files appear
    // separately in the trace. Skip directory/link entries instead of importing untraced files.
    const info = await lstat(source); if (info.isDirectory() || info.isSymbolicLink()) continue;
    await mkdir(path.dirname(target), { recursive: true }); await copyFile(source, target);
  }
  const passage = "Original public document text from the isolated assembled production runtime. ";
  const html = `<html><head><title>Fixture</title></head><body><article><h1>Fixture</h1><p>${passage.repeat(20)}</p></article></body></html>`;
  const extractedHtml = await worker("html-reader-worker.mjs", [], JSON.stringify({ text: html, finalUrl: "https://example.com/article" }));
  assert.ok(extractedHtml.text.includes(passage.trim())); assert.equal(extractedHtml.kind, "html");
  const extractedPdf = await worker("pdf-reader-worker.mjs", ["2", "1000"], pdf("Original PDF evidence"));
  assert.equal(extractedPdf.text, "Original PDF evidence"); assert.equal(extractedPdf.pagesRead, 1);
  console.log("Assembled production trace: actual HTML and PDF extraction passed (no network or secrets).");
} finally {
  assert.equal(path.dirname(path.resolve(assembled)), path.resolve(tmpdir()));
  assert.ok(path.basename(assembled).startsWith("keryx-readers-"));
  await rm(assembled, { recursive: true, force: true });
}

function worker(name, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=64", path.join(assembled, "lib/web-research", name), ...args],
      { cwd: assembled, windowsHide: true, env: { NODE_ENV: "production" }, stdio: ["pipe", "pipe", "pipe"] });
    // Windows antivirus can delay imports from a freshly copied directory. This fixture checks
    // asset closure, not parser latency; application HTML/PDF deadlines remain 4s/5s.
    let output = ""; const timer = setTimeout(() => child.kill("SIGKILL"), process.platform === "win32" ? 30000 : 15000);
    child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => { output += chunk; if (output.length > 400000) child.kill("SIGKILL"); });
    child.stderr.on("data", chunk => process.stderr.write(chunk));
    child.on("error", reject); child.stdin.on("error", reject);
    child.on("close", (code, signal) => { clearTimeout(timer); try { assert.equal(code, 0, `${name} failed (${signal ?? code}); output bytes ${output.length}`); resolve(JSON.parse(output)); } catch (error) { reject(error); } });
    child.stdin.end(input);
  });
}
function pdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [4 0 R] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body = "%PDF-1.7\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return Buffer.from(body + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
