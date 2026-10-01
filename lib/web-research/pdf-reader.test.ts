import { describe, expect, it } from "vitest";
import { extractPdfText } from "./pdf-reader";

// A real uncompressed PDF with correct object offsets; no binary fixture needed.
function pdf(pages: string[], actions = false): Uint8Array {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${actions ? '/OpenAction << /S /JavaScript /JS (fetch("https://invalid.example/execute")) >>' : ""} >>`,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < pages.length; i++) {
    const stream = `BT /F1 12 Tf 72 720 Td (${pages[i].replace(/[\\()]/g, "\\$&")}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let body = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body));
}

const options = { maxPages: 4, maxChars: 2000, timeoutMs: 10_000 };

describe("contained PDF text extraction", () => {
  it("extracts real PDF text without executing document JavaScript", async () => {
    const value = await extractPdfText(pdf(["Actual source text"], true), options);
    expect(value).toEqual({ text: "Actual source text", pagesRead: 1, totalPages: 1, truncated: false });
  });

  it("bounds actual pages and text and reports truncation", async () => {
    const pages = await extractPdfText(pdf(["First page", "Second page"]), { ...options, maxPages: 1 });
    expect(pages).toEqual({ text: "First page", pagesRead: 1, totalPages: 2, truncated: true });
    const chars = await extractPdfText(pdf(["Long source text"]), { ...options, maxChars: 4 });
    expect(chars.text).toBe("Long");
    expect(chars.truncated).toBe(true);
  });

  it("rejects malformed, empty-text and oversized input with sanitized errors", async () => {
    for (const bytes of [new Uint8Array(Buffer.from("secret malformed content")), pdf([""]), new Uint8Array(2 * 1024 * 1024 + 1)]) {
      await expect(extractPdfText(bytes, options)).rejects.toThrow("PDF text extraction failed");
    }
  });

  it("refuses encrypted input without a password or fallback text", async () => {
    const original = Buffer.from(pdf(["Restricted source"])).toString("utf8");
    const encrypted = original
      .replace("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> /P -4 >>`)
      .replace("/Root 1 0 R >>", "/Root 1 0 R /Encrypt 3 0 R /ID [<0000000000000000><0000000000000000>] >>");
    await expect(extractPdfText(new Uint8Array(Buffer.from(encrypted)), options)).rejects.toThrow("PDF text extraction failed");
  });

  it("kills a real child on deadline then permits another extraction", async () => {
    await expect(extractPdfText(pdf(["Deadline"]), { ...options, timeoutMs: 1 })).rejects.toMatchObject({ name: "Error" });
    expect((await extractPdfText(pdf(["Recovered"]), options)).text).toBe("Recovered");
  });

  it("kills a real child on caller cancellation and handles already cancelled callers", async () => {
    const controller = new AbortController();
    const pending = extractPdfText(pdf(["Cancelled"]), { ...options, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(extractPdfText(pdf(["Cancelled"]), { ...options, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect((await extractPdfText(pdf(["Recovered"]), options)).text).toBe("Recovered");
  });

  it("rejects overlapping parser work instead of creating another child", async () => {
    const controller = new AbortController();
    const active = extractPdfText(pdf(["Active"]), { ...options, signal: controller.signal });
    await expect(extractPdfText(pdf(["Overloaded"]), options)).rejects.toThrow("PDF text extraction failed");
    controller.abort();
    await expect(active).rejects.toMatchObject({ name: "AbortError" });
    expect((await extractPdfText(pdf(["Recovered"]), options)).text).toBe("Recovered");
  });
});
