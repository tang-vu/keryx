import { expect, it } from "vitest";
import { extractHtml } from "./html-reader";

const passage = "The original evidence retains its qualifications; readable text alone does not guarantee accuracy. ";
const body = passage.repeat(16).trim();
const longHost = ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(57), "com"].join(".");

// Exercise the real bounded child and parent output validation through both
// semantic-region extraction and the Mozilla Readability fallback.
for (const region of ["main", "div"]) {
  const document = (title?: string) => `<html><head>${title === undefined ? "" : `<title>${title}</title>`}</head><body><${region}><p>${body}</p></${region}></body></html>`;

  it.each([
    { name: "a supplementary character crossing the cap", title: "a".repeat(199) + "\u{1F9FE}", expected: "a".repeat(199) },
    { name: "a supplementary character exactly at the cap", title: "a".repeat(198) + "\u{1F9FE}", expected: "a".repeat(198) + "\u{1F9FE}" },
    { name: "a supplementary character beyond the cap", title: "a".repeat(200) + "\u{1F9FE}", expected: "a".repeat(200) },
    { name: "an oversized BMP title", title: "\u00E9".repeat(201), expected: "\u00E9".repeat(200) },
    { name: "normalization before clipping", title: " \n" + "a".repeat(197) + "\t\n\u{1F9FE}  ", expected: "a".repeat(197) + " \u{1F9FE}" },
    { name: "a short decoded original title", title: "Original &amp; limits", expected: "Original & limits" },
  ])(`${region}: preserves the exact bounded prefix for $name`, async ({ title, expected }) => {
    const finalUrl = `https://${longHost}/original`;
    const result = await extractHtml(document(title), finalUrl);
    expect(result.title).toBe(expected);
    expect(result.title.length).toBeLessThanOrEqual(200);
    expect(result.title.isWellFormed()).toBe(true);
    expect(result).toMatchObject({ text: body, finalUrl, kind: "html", truncated: false });
    expect(result.htmlTextLayout?.textCharacters).toBe(body.length);
  });

  it.each([undefined, "", " \t\n "])(`${region}: bounds the hostname fallback for absent or empty title %j`, async (title) => {
    expect(longHost).toHaveLength(253);
    const finalUrl = `https://${longHost}/original`;
    const result = await extractHtml(document(title), finalUrl);
    expect(result.title).toBe(longHost.slice(0, 200));
    expect(result).toMatchObject({ text: body, finalUrl, kind: "html", truncated: false });
  });
}
