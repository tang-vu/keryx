import sniffHtmlEncoding from "html-encoding-sniffer";
import { labelToName, legacyHookDecode } from "@exodus/bytes/encoding.js";

/** Decode capped article bytes before inert extraction. HTML uses its standard
 * 1024-byte declaration prescan; other formats never interpret meta markup.
 * BOM wins over HTTP, which wins over HTML metadata. Keep the existing UTF8
 * fallback for undeclared documents; do not guess from language or URL. */
export function decodeArticleText(bytes: Uint8Array, contentType: string, charset?: string): string {
  const encoding = contentType === "text/html"
    ? sniffHtmlEncoding(bytes, { transportLayerEncodingLabel: charset, defaultEncoding: "UTF-8" })
    : labelToName(charset ?? "") ?? "UTF-8";
  return legacyHookDecode(bytes, encoding.toLowerCase());
}
