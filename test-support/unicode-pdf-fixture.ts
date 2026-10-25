/** Synthetic single-page PDF with an explicit ToUnicode map. This exercises the
 * actual PDF.js text extraction, not a mocked text item or research evidence. */
export function unicodePdfFixture(text: string): Uint8Array {
  const characters = [...new Set(Array.from(text))];
  if (characters.length > 90) throw new Error("Synthetic font capacity");
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  const mappings = characters.map((character, index) => {
    let utf16 = "";
    for (let unit = 0; unit < character.length; unit++) utf16 += character.charCodeAt(unit).toString(16).padStart(4, "0");
    return `<${hex(index + 33)}> <${utf16}>`;
  });
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /SyntheticUnicode def /CMapType 2 def
1 begincodespacerange <00> <ff> endcodespacerange
${mappings.length} beginbfchar ${mappings.join("\n")} endbfchar
endcmap CMapName currentdict /CMap defineresource pop end end`;
  const content = `BT /F1 12 Tf 72 720 Td <${Array.from(text).map(character => hex(characters.indexOf(character) + 33)).join("")}> Tj ET`;
  const stream = (value: string) => `<< /Length ${Buffer.byteLength(value)} >>\nstream\n${value}\nendstream`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [4 0 R] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    stream(content), stream(cmap)];
  let body = "%PDF-1.7\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body));
}
