import { Buffer } from "node:buffer";

/** Small real PDFs: null draws an image with no text operators or OCR layer.
 * These synthetic pages are a reader oracle, never scientific evidence. */
export function pdfFixture(pages: readonly (string | null)[]): Uint8Array {
  const stream = (bytes: Buffer, attributes = "") => Buffer.concat([
    Buffer.from(`<< /Length ${bytes.length} ${attributes} >>\nstream\n`), bytes, Buffer.from("\nendstream"),
  ]);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${5 + 2 * i} 0 R`).join(" ")}] >>`),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    stream(Buffer.from([0, 0, 0]), "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8"),
  ];
  for (const [i, text] of pages.entries()) {
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`));
    objects.push(stream(Buffer.from(text === null ? "q 200 0 0 200 72 400 cm /Im1 Do Q" :
      `BT /F1 12 Tf 72 720 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`)));
  }
  const parts = [Buffer.from("%PDF-1.7\n")], offsets = [0];
  let position = parts[0].length;
  for (const [i, object] of objects.entries()) {
    const bytes = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    offsets.push(position); parts.push(bytes); position += bytes.length;
  }
  parts.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}
