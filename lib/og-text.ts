import { createElement, type ReactElement } from "react";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

interface PreviewTextOptions {
  fontSize: number;
  maxWidth: number;
  maxHeight: number;
  color: string;
}

let bundledRenderer: Promise<typeof import("sharp")["default"]> | undefined;
function textRenderer() {
  bundledRenderer ??= (async () => {
    const { default: sharp } = await import("sharp");
    // libvips registers fontfile in its shared, locked Pango font map. Register
    // these fixed bundled faces once, so mixed-script text never needs a host's
    // CJK/Indic fonts. No fontconfig environment or font service is modified.
    for (const [family, filename] of [
      ["Noto Sans", "noto-sans-regular.ttf"],
      ["Noto Sans JP", "noto-sans-jp-regular.otf"],
      ["Noto Sans KR", "noto-sans-kr-regular.otf"],
      ["Noto Sans SC", "noto-sans-sc-regular.otf"],
      ["Noto Sans Devanagari", "noto-sans-devanagari-regular.ttf"],
      ["Noto Sans Math", "noto-sans-math-regular.ttf"],
    ]) {
      const fontfile = join(process.cwd(), "app/fonts/og", filename);
      await access(fontfile, constants.R_OK);
      await sharp({ text: { text: "x", font: `${family} 12`, fontfile, dpi: 72, rgba: true }, limitInputPixels: 1024 })
        .timeout({ seconds: 5 }).png().toBuffer();
    }
    return sharp;
  })().catch(error => { bundledRenderer = undefined; throw error; });
  return bundledRenderer;
}

/** Satori has glyph coverage without full Devanagari shaping. Rasterize only
 * that script with the local Pango/HarfBuzz renderer before ImageResponse layout.
 * Call after public visibility admission; this helper reads no records or URLs.
 * Other scripts keep the original text node and existing layout byte-for-byte. */
export async function publicPreviewText(text: string, options: PreviewTextOptions): Promise<string | ReactElement> {
  if (!/[\p{Script=Devanagari}।॥]/u.test(text)) return text;
  return publicPreviewFittedText(text, options);
}

/** Fit a complete original field inside an explicit card region. Unlike the
 * script-specific adapter above, profiles need this for long names in any script.
 * Call after public admission and recheck publication after all shaping I/O. */
export async function publicPreviewFittedText(text: string, options: PreviewTextOptions): Promise<string | ReactElement> {
  if (!Number.isInteger(options.fontSize) || options.fontSize < 12 || options.fontSize > 72 ||
      !Number.isInteger(options.maxWidth) || options.maxWidth < 32 || options.maxWidth > 1120 ||
      !Number.isInteger(options.maxHeight) || options.maxHeight < 1 || options.maxHeight > 550 ||
      !/^#[0-9a-f]{6}$/iu.test(options.color) || text.length > 512)
    throw new Error("Invalid public preview text bounds");

  // Treat original names/questions as literal text, never Pango markup. Keep
  // well-formed original Unicode (including its normalization) unchanged.
  const display = text.toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "\ufffd");
  if (!/\S/u.test(display)) return display;
  const literal = display.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const sharp = await textRenderer();
  const input = {
    text: `<span foreground="${options.color}" insert_hyphens="false">${literal}</span>`,
    font: `Noto Sans,Noto Sans JP,Noto Sans KR,Noto Sans SC,Noto Sans Devanagari,Noto Sans Math ${options.fontSize}`,
    rgba: true, width: options.maxWidth, wrap: "word-char" as const,
  };
  let raster = await sharp({ text: { ...input, dpi: 72 }, limitInputPixels: 1_500_000 })
    .timeout({ seconds: 5 }).png().toBuffer({ resolveWithObject: true });
  if (raster.info.height > options.maxHeight || raster.info.width > options.maxWidth) {
    // With height and no explicit dpi, Pango fits AND rewraps inside the region.
    // Shrinking the first bitmap alone wastes width and makes long names tiny.
    raster = await sharp({ text: { ...input, height: options.maxHeight }, limitInputPixels: 1_500_000 })
      .resize({ width: options.maxWidth, height: options.maxHeight, fit: "inside", withoutEnlargement: true })
      .timeout({ seconds: 5 }).png().toBuffer({ resolveWithObject: true });
  }
  const { data, info } = raster;
  return createElement("img", { src: `data:image/png;base64,${data.toString("base64")}`, alt: display,
    width: info.width, height: info.height, style: { objectFit: "contain", flexShrink: 0 } });
}
