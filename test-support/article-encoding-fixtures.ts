/** Synthetic publisher bytes. Literal byte sequences stay independent of the
 * decoder under test; real Chromium also verifies their Unicode interpretation. */
export const ARTICLE_ENCODINGS = [
  { name: "Windows-1252/Latin1 label", charset: "iso-8859-1", text: "Café — 12 €", hex: "436166e920972031322080" },
  { name: "GBK", charset: "gbk", text: "中国人口", hex: "d6d0b9fac8cbbfda" },
  { name: "Shift_JIS", charset: "shift_jis", text: "日本の人口", hex: "93fa967b82cc906c8cfb" },
  { name: "Big5", charset: "big5", text: "中國人口", hex: "a4a4b0eaa448a466" },
  { name: "Windows-1251", charset: "windows-1251", text: "Москва", hex: "cceef1eae2e0" },
] as const;
export type ArticleEncodingFixture = typeof ARTICLE_ENCODINGS[number];
const qualification = " is the publisher wording. This documented qualification must remain in the original excerpt. ";
export const encodedArticleText = (fixture: ArticleEncodingFixture) => (fixture.text + qualification).repeat(5).trim();
export const decodedArticleHtml = (fixture: ArticleEncodingFixture, head = "") =>
  `<html><head>${head}<title>${fixture.text}</title></head><body><main><p>${encodedArticleText(fixture)}</p></main></body></html>`;
export function encodedArticleBytes(fixture: ArticleEncodingFixture, head = ""): Buffer {
  const word = Buffer.from(fixture.hex, "hex");
  return Buffer.concat([
    Buffer.from(`<html><head>${head}<title>`, "ascii"), word,
    Buffer.from("</title></head><body><main><p>", "ascii"),
    ...Array.from({ length: 5 }, (_, index) => Buffer.concat([word, Buffer.from(index === 4 ? qualification.trimEnd() : qualification, "ascii")])),
    Buffer.from("</p></main></body></html>", "ascii"),
  ]);
}
export const utf8ArticleText = "Đoàn 🧾 — München. The exact source qualification remains visible. ".repeat(4).trim();
export const utf8ArticleHtml = (head = "") => `<html><head>${head}<title>Unicode original</title></head><body><main><p>${utf8ArticleText}</p></main></body></html>`;
