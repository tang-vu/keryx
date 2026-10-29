import { readFile } from "node:fs/promises";
import { join } from "node:path";

type OgFont = { name: string; data: Buffer; weight: 400; style: "normal" };

let latin: Promise<OgFont> | undefined;
let chinese: Promise<OgFont> | undefined;
let japanese: Promise<OgFont> | undefined;
let korean: Promise<OgFont> | undefined;
let devanagari: Promise<OgFont> | undefined;
let math: Promise<OgFont> | undefined;

/** Local, licensed fonts. Script selection is glyph coverage, never answer-language evidence. */
export async function publicPreviewFonts(text: string): Promise<OgFont[]> {
  latin ??= readFile(join(process.cwd(), "app/fonts/og/noto-sans-regular.ttf"))
    .then(data => ({ name: "Keryx Sans", data, weight: 400 as const, style: "normal" as const }))
    .catch(error => { latin = undefined; throw error; });
  const fonts = [await latin];
  if (/\p{Sm}/u.test(text)) {
    math ??= readFile(join(process.cwd(), "app/fonts/og/noto-sans-math-regular.ttf"))
      .then(data => ({ name: "Keryx Math", data, weight: 400 as const, style: "normal" as const }))
      .catch(error => { math = undefined; throw error; });
    fonts.push(await math);
  }
  if (/\p{Script=Han}/u.test(text)) {
    chinese ??= readFile(join(process.cwd(), "app/fonts/og/noto-sans-sc-regular.otf"))
      .then(data => ({ name: "Keryx Sans SC", data, weight: 400 as const, style: "normal" as const }))
      .catch(error => { chinese = undefined; throw error; });
    fonts.push(await chinese);
  }
  if (/[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(text)) {
    japanese ??= readFile(join(process.cwd(), "app/fonts/og/noto-sans-jp-regular.otf"))
      .then(data => ({ name: "Keryx Sans JP", data, weight: 400 as const, style: "normal" as const }))
      .catch(error => { japanese = undefined; throw error; });
    fonts.push(await japanese);
  }
  if (/\p{Script=Hangul}/u.test(text)) {
    korean ??= readFile(join(process.cwd(), "app/fonts/og/noto-sans-kr-regular.otf"))
      .then(data => ({ name: "Keryx Sans KR", data, weight: 400 as const, style: "normal" as const }))
      .catch(error => { korean = undefined; throw error; });
    fonts.push(await korean);
  }
  if (/[\p{Script=Devanagari}।॥]/u.test(text)) {
    devanagari ??= readFile(join(process.cwd(), "app/fonts/og/noto-sans-devanagari-regular.ttf"))
      .then(data => ({ name: "Keryx Sans Devanagari", data, weight: 400 as const, style: "normal" as const }))
      .catch(error => { devanagari = undefined; throw error; });
    fonts.push(await devanagari);
  }
  return fonts;
}

/** Use these loaded faces instead of relying on the image renderer's network font fallback. */
export const publicPreviewFontFamily = "Keryx Sans, Keryx Sans JP, Keryx Sans KR, Keryx Sans SC, Keryx Sans Devanagari, Keryx Math";
