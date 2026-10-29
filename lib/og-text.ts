import { createElement, type ReactElement } from "react";
import { join } from "node:path";

interface PreviewTextOptions {
  fontSize: number;
  maxWidth: number;
  maxHeight: number;
  color: string;
}

/** Satori has glyph coverage without full Devanagari shaping. Rasterize only
 * that script with the local Pango/HarfBuzz renderer before ImageResponse layout.
 * Call after public visibility admission; this helper reads no records or URLs.
 * Other scripts keep the original text node and existing layout byte-for-byte. */
export async function publicPreviewText(text: string, options: PreviewTextOptions): Promise<string | ReactElement> {
  if (!/[\p{Script=Devanagari}।॥]/u.test(text)) return text;
  if (!Number.isInteger(options.fontSize) || options.fontSize < 12 || options.fontSize > 72 ||
      !Number.isInteger(options.maxWidth) || options.maxWidth < 32 || options.maxWidth > 1120 ||
      !Number.isInteger(options.maxHeight) || options.maxHeight < 1 || options.maxHeight > 550 ||
      !/^#[0-9a-f]{6}$/iu.test(options.color) || text.length > 512)
    throw new Error("Invalid public preview text bounds");

  // Treat original names/questions as literal text, never Pango markup. Keep
  // well-formed original Unicode (including its normalization) unchanged.
  const display = text.toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "\ufffd");
  const literal = display.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp({ text: {
    text: `<span foreground="${options.color}">${literal}</span>`,
    font: `Noto Sans Devanagari ${options.fontSize}`,
    fontfile: join(process.cwd(), "app/fonts/og/noto-sans-devanagari-regular.ttf"),
    dpi: 72, rgba: true, width: options.maxWidth, wrap: "word-char",
  }, limitInputPixels: 1_500_000 })
    .resize({ width: options.maxWidth, height: options.maxHeight, fit: "inside", withoutEnlargement: true })
    .timeout({ seconds: 5 }).png().toBuffer({ resolveWithObject: true });
  return createElement("img", { src: `data:image/png;base64,${data.toString("base64")}`, alt: display,
    width: info.width, height: info.height, style: { objectFit: "contain" } });
}
