import { isValidElement, type ReactElement } from "react";
import sharp from "sharp";
import { expect, it } from "vitest";
import { publicPreviewText } from "./og-text";

const bounds = { fontSize: 32, maxWidth: 1120, maxHeight: 550, color: "#1B1712" };
interface ImageProps { src: string; alt: string; width: number; height: number }
function image(result: string | ReactElement) {
  expect(isValidElement(result)).toBe(true);
  const value = result as ReactElement<ImageProps>;
  expect(value.type).toBe("img"); expect(value.props.src).toMatch(/^data:image\/png;base64,/u);
  return { props: value.props, png: Buffer.from(value.props.src.split(",")[1], "base64") };
}

it.each(["English <original> & exact", "Tiếng Việt chưa thay đổi", "日本語の原文", "한국어 원문", "Deutsch: ursprüngliche Quelle", "Sumber asli Indonesia"])(
  "preserves the exact existing text node outside Devanagari: %s", async text => {
    expect(await publicPreviewText(text, bounds)).toBe(text);
  });

it("shapes Hindi clusters within the independent browser-reference width instead of Satori's unjoined glyph width", async () => {
  const text = "हिन्दी: शोध रिपोर्ट, उद्धरण, प्रमाण, प्रश्न और उत्तर। क्ष त्र ज्ञ श्र";
  const { props, png } = image(await publicPreviewText(text, bounds));
  expect(props.alt).toBe(text);
  // Same local font/32px Chromium and Pango references occupy about685px;
  // unshaped Satori occupies about850px and visibly separates conjuncts.
  expect(props.width).toBeGreaterThan(600); expect(props.width).toBeLessThan(740);
  expect(props.height).toBeGreaterThan(20); expect(props.height).toBeLessThan(80);
  const metadata = await sharp(png).metadata();
  expect(metadata.width).toBe(props.width); expect(metadata.height).toBe(props.height);
});

it("renders markup-like original text literally without applying an injected Pango colour", async () => {
  const text = '<span foreground="red">हिन्दी</span> & <b>उत्तर</b>';
  const { props, png } = image(await publicPreviewText(text, bounds));
  expect(props.alt).toBe(text);
  const plain = image(await publicPreviewText("हिन्दी & उत्तर", bounds));
  expect(props.width).toBeGreaterThan(plain.props.width);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = false;
  for (let at = 0; at < data.length; at += info.channels)
    if (data[at + 3] > 200 && data[at] > 150 && data[at + 1] < 80 && data[at + 2] < 80) red = true;
  expect(red).toBe(false);
});

it("bounds wrapped long Hindi text without losing its original alternative text", async () => {
  const text = "इस शोध के दावों और सीमाओं का समर्थन किन स्रोतों से होता है? ".repeat(5);
  const { props } = image(await publicPreviewText(text, { ...bounds, maxWidth: 240, maxHeight: 90 }));
  expect(props.width).toBeLessThanOrEqual(240); expect(props.height).toBeLessThanOrEqual(90);
  expect(props.alt).toBe(text);
});

it("preserves Unicode normalization and replaces invalid display controls without changing the source", async () => {
  const text = "हिन्दी: café".normalize("NFD");
  expect(image(await publicPreviewText(text, bounds)).props.alt).toBe(text);
  const controlled = text + "\u0000";
  expect(image(await publicPreviewText(controlled, bounds)).props.alt).toBe(text + "\ufffd");
  expect(controlled).toBe(text + "\u0000");
});

it.each([
  { fontSize: 0 }, { fontSize: 73 }, { fontSize: 12.5 }, { maxWidth: 31 }, { maxWidth: 1121 },
  { maxWidth: NaN }, { maxHeight: 0 }, { maxHeight: 551 }, { color: 'red"><span foreground="red"' },
])("refuses invalid raster bounds or markup parameters %j", async invalid => {
  await expect(publicPreviewText("हिन्दी", { ...bounds, ...invalid })).rejects.toThrow("Invalid public preview text bounds");
});
it("refuses oversized native text before allocating a raster", async () => {
  await expect(publicPreviewText("ह".repeat(513), bounds)).rejects.toThrow("Invalid public preview text bounds");
});
