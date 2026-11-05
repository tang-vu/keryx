import { expect, it } from "vitest";
import { extractHtml } from "./html-reader";

const introduction = "This reference describes a command and its limits. Its examples are illustrative and do not establish application correctness. ";
const named = '<div class="refnamediv"><h2>FETCH WORK</h2><p>Read pending work records.</p></div>';
const caveat = "Skipping a busy row can omit work from this result. Other locks can still require a wait.";
const section = `<div class="refsect2" id="FETCH-FOR-UPDATE-SHARE"><h3>Locking behavior</h3><p>${caveat}</p><pre>BEGIN;\n  SELECT work_item;\nCOMMIT;</pre></div>`;
const entry = (body = section, attributes = 'class="refentry"') => `<div ${attributes}>${named}<div class="refsect1"><h2>Description</h2><p>${introduction.repeat(7)}</p>${body}</div></div>`;
const document = (body: string) => `<html><head><title>Command reference</title></head><body>${body}</body></html>`;

it("keeps a named reference entry's locking qualification and code despite a share-like section ID", async () => {
  const result = await extractHtml(document(`<nav>Unrelated site navigation.</nav>${entry()}<footer>Unrelated site footer.</footer>`), "https://reference.example/manual/command");
  expect(result.text).toContain("FETCH WORK");
  expect(result.text).toContain("Locking behavior");
  expect(result.text).toContain(caveat);
  expect(result.text).toContain("BEGIN;\n  SELECT work_item;\nCOMMIT;");
  expect(result.text).not.toContain("Unrelated site");
  expect(result.truncated).toBe(false);
  expect(result.htmlTextLayout?.headings.some(({ start, end }) => result.text.slice(start, end).includes("Locking behavior"))).toBe(true);
});

it("preserves tables, visible caveats and hidden-content boundaries inside the reference entry", async () => {
  const body = `${section}<table><tr><th>Setting</th><th>Limit</th></tr><tr><td>Skip busy rows</td><td>Partial view</td></tr></table><p hidden>Hidden false guarantee.</p><section style="display:none">Hidden false guarantee.</section><section style="visibility:hidden">Hidden false guarantee.<p style="visibility:visible">Visible recovery qualification.</p></section><script>executeUntrustedCode()</script><template><p>Hidden false guarantee.</p></template>`;
  const result = await extractHtml(document(entry(body)), "https://reference.example/manual/command");
  expect(result.text).toContain(caveat);
  expect(result.text).toContain("Setting | Limit |");
  expect(result.text).toContain("Skip busy rows | Partial view |");
  expect(result.text).toContain("Visible recovery qualification.");
  expect(result.text).not.toMatch(/Hidden false guarantee|executeUntrustedCode/);
});

it.each(["main", "article"])("keeps the existing explicit %s ahead of a separate reference entry", async (tag) => {
  const primary = `<${tag}><h1>Primary original</h1><p>${introduction.repeat(4)}</p><p>Primary original qualification.</p></${tag}>`;
  const result = await extractHtml(document(`${entry()}${primary}`), "https://reference.example/primary");
  expect(result.text).toContain("Primary original qualification.");
  expect(result.text).not.toContain("FETCH WORK");
});

it("ignores a hidden reference entry when selecting the sole visible named document", async () => {
  const hidden = entry('<p>Hidden competing document.</p>', 'class="refentry" hidden');
  const result = await extractHtml(document(`${hidden}${entry()}`), "https://reference.example/manual/visible");
  expect(result.text).toContain(caveat);
  expect(result.text).not.toContain("Hidden competing document.");
});

it("does not treat a lookalike class or an unnamed container as the declared document", async () => {
  const primary = `<div class="article"><h1>Primary narrative</h1><p>${introduction.repeat(15)}</p><p>Primary narrative qualification.</p></div>`;
  for (const incidental of [entry("<p>Short unrelated card.</p>", 'class="refentry-card"'), '<div class="refentry"><p>Short unrelated card.</p></div>']) {
    const result = await extractHtml(document(`${incidental}${primary}`), "https://reference.example/narrative");
    expect(result.text).toContain("Primary narrative qualification.");
  }
});

it("does not select the first of multiple named reference entries as the complete document", async () => {
  const primary = `<div class="article"><h1>Combined reference</h1><p>${introduction.repeat(30)}</p><p>Qualification covering both entries.</p></div>`;
  const result = await extractHtml(document(`${entry()}${entry()}${primary}`), "https://reference.example/manual/combined");
  expect(result.text).toContain("Qualification covering both entries.");
});

it("does not promote a reference marker whose only naming heading is hidden", async () => {
  const incidental = entry().replace("<h2>FETCH WORK</h2>", "<h2 hidden>FETCH WORK</h2>");
  const primary = `<div class="article"><h1>Visible original</h1><p>${introduction.repeat(30)}</p><p>Visible original qualification.</p></div>`;
  const result = await extractHtml(document(`${incidental}${primary}`), "https://reference.example/visible");
  expect(result.text).toContain("Visible original qualification.");
  expect(result.text).not.toContain("FETCH WORK");
});

it("retains the normal character cap and reports a truncated long reference entry", async () => {
  const result = await extractHtml(document(entry(`${section}<p>${introduction.repeat(600)}</p><p>Beyond the admitted text.</p>`)), "https://reference.example/manual/long");
  expect(result.text).toContain(caveat);
  expect(result.text).toHaveLength(60000);
  expect(result.truncated).toBe(true);
  expect(result.text).not.toContain("Beyond the admitted text.");
});
