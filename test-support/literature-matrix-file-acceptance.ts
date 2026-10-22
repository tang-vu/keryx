import assert from "node:assert/strict";
import type { Download, Page } from "playwright";
import { literatureMatrixJson, MAX_MATRIX_FILE_BYTES } from "../lib/research-tools/literature-matrix-file";
import { emptyMatrixRow, literatureMatrixCsv } from "../lib/research-tools/literature-matrix";
import { researchGuidesCopy } from "../locales/en/research-guides";

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream(); assert(stream);
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Real local File APIs and downloads. Caller blocks every non-GET request. */
export async function checkLiteratureMatrixFiles(page: Page) {
  const copy = researchGuidesCopy.tool;
  const question = await page.getByLabel(copy.question, { exact: true }).inputValue();
  const title = await page.getByLabel(copy.columns.title, { exact: true }).inputValue();
  const finding = await page.getByLabel(copy.columns.finding, { exact: true }).inputValue();
  const fileInput = page.getByLabel(copy.open, { exact: true });
  const preview = page.getByRole("region", { name: copy.preview, exact: true });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: copy.save, exact: true }).click();
  const saved = await download;
  assert.equal(saved.suggestedFilename(), "literature-review-matrix.json");
  const backup = await downloadBytes(saved), data = JSON.parse(backup.toString("utf8"));
  assert.equal(data.question, question); assert.equal(data.rows[0].title, title); assert.equal(data.rows[0].finding, finding);
  const upload = async (buffer: Buffer, name = "matrix.json") => fileInput.setInputFiles({ name, mimeType: name.endsWith(".csv") ? "text/csv" : "application/json", buffer });
  const warns = () => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  assert.equal(await warns(), false, "Saved editable file clears the reload warning");
  await upload(backup);
  await preview.waitFor();
  await page.getByRole("button", { name: copy.cancel, exact: true }).click();
  assert.equal(await page.getByLabel(copy.columns.finding, { exact: true }).inputValue(), finding);

  // A genuine reload empties the tab; the downloaded editable file resumes it exactly.
  await page.reload();
  await page.getByLabel(copy.open, { exact: true }).setInputFiles({ name: "matrix.json", mimeType: "application/json", buffer: backup });
  await preview.waitFor();
  await page.getByRole("button", { name: copy.replace, exact: true }).click();
  assert.equal(await page.getByLabel(copy.question, { exact: true }).inputValue(), question);
  assert.equal(await page.getByLabel(copy.columns.title, { exact: true }).inputValue(), title);
  assert.equal(await page.getByLabel(copy.columns.finding, { exact: true }).inputValue(), finding);

  await upload(backup);
  await preview.waitFor();
  await page.getByLabel(copy.columns.finding, { exact: true }).fill("New notes while preview is open");
  assert.equal(await warns(), true, "Changed notes retain the reload warning");
  assert(await page.getByRole("button", { name: copy.replace, exact: true }).isDisabled());
  await page.getByText(copy.staleImport, { exact: true }).waitFor();
  await page.getByRole("button", { name: copy.cancel, exact: true }).click();
  assert.equal(await page.getByLabel(copy.columns.finding, { exact: true }).inputValue(), "New notes while preview is open");

  await page.evaluate(`(() => {
    const original = URL.createObjectURL;
    Object.defineProperty(window, "matrixRestoreDownload", { configurable: true, value: () => { URL.createObjectURL = original; } });
    URL.createObjectURL = () => { throw new Error("Download refused by browser fixture"); };
  })()`);
  await page.getByRole("button", { name: copy.save, exact: true }).click();
  await page.getByRole("alert").filter({ hasText: copy.fileErrors.download }).waitFor();
  assert.equal(await warns(), true, "Refused download never clears unsaved work");
  await page.evaluate("window.matrixRestoreDownload()");

  for (const [buffer, name, expected] of [
    [Buffer.from('{"version":999}'), "bad.json", copy.fileErrors.format],
    [Buffer.from("title,notes\nA,B"), "bad.csv", copy.fileErrors.headers],
    [Buffer.from([0xff, 0xfe]), "bad.csv", copy.fileErrors.encoding],
    [Buffer.alloc(MAX_MATRIX_FILE_BYTES + 1), "large.json", copy.fileErrors.size],
  ] as const) {
    await upload(buffer, name);
    await page.getByRole("alert").filter({ hasText: expected }).waitFor();
    assert.equal(await page.getByLabel(copy.columns.finding, { exact: true }).inputValue(), "New notes while preview is open");
    assert.equal(await page.locator("fieldset").count(), 1);
  }

  const incoming = { ...emptyMatrixRow(), title: '<img src=x onerror="alert(1)">', finding: "=1+2\nEvidence 🧪" };
  await upload(Buffer.from(literatureMatrixJson("Different research question", [incoming])));
  await preview.waitFor();
  assert(await page.getByRole("button", { name: copy.append, exact: true }).isDisabled());
  await page.getByText(copy.appendQuestion, { exact: true }).waitFor();
  await page.getByRole("button", { name: copy.cancel, exact: true }).click();
  const csv = Buffer.from(literatureMatrixCsv(question, [incoming]));
  await upload(csv, "matrix.csv");
  await preview.waitFor();
  assert.equal(await preview.locator('img[src="x"]').count(), 0, "Imported title stays literal text");
  await page.getByRole("button", { name: copy.append, exact: true }).click();
  assert.equal(await page.locator("fieldset").count(), 2);
  assert.equal(await page.getByLabel(copy.columns.finding, { exact: true }).nth(0).inputValue(), "New notes while preview is open");
  assert.equal(await page.getByLabel(copy.columns.finding, { exact: true }).nth(1).inputValue(), "'" + incoming.finding);
  assert.equal(await page.getByLabel(copy.columns.title, { exact: true }).nth(1).inputValue(), incoming.title);
  assert.equal(await page.locator('main img[src="x"]').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Import UI fits viewport");
  await page.getByRole("button", { name: `${copy.remove} 2`, exact: true }).click();

  // A late read from a previously chosen file must not replace the newer preview.
  await page.evaluate(`(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function() {
      if (this.name === "unreadable.json") throw new Error("File read refused by browser fixture");
      if (this.name === "slow.json") await new Promise(resolve => setTimeout(resolve, 350));
      return original.call(this);
    };
  })()`);
  await upload(backup, "unreadable.json");
  await page.getByRole("alert").filter({ hasText: copy.fileErrors.read }).waitFor();
  assert.equal(await page.getByLabel(copy.columns.finding, { exact: true }).inputValue(), "New notes while preview is open");
  await upload(Buffer.from(literatureMatrixJson("Old slow question", [])), "slow.json");
  await upload(backup, "latest.json");
  await preview.getByText("latest.json", { exact: true }).waitFor();
  await page.waitForTimeout(400);
  assert.equal(await preview.getByText("slow.json", { exact: true }).count(), 0);
  await page.getByRole("button", { name: copy.replace, exact: true }).click();
  assert.equal(await page.getByLabel(copy.columns.finding, { exact: true }).inputValue(), finding);
}
