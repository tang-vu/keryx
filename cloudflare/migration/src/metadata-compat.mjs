import { createHash } from "node:crypto";

// vinext 1.4.2 treats an alternate descriptor array as one URL. Preserve the
// application's supported Next metadata, including every URL and its title.
const expected = "b11f31c4bf8d0af16e82cb681a21ba2a8d9a088286670c20bc111cbfc56666f3";
export function patchMetadataAlternates(source) {
  if (createHash("sha256").update(source).digest("hex") !== expected) {
    throw new Error("Pinned metadata adapter changed; review alternate-link compatibility");
  }
  for (const [collection, key, attribute] of [["languages", "lang", "hrefLang: lang"], ["media", "media", "media"], ["types", "type", "type"]]) {
    const original = `if (alt.${collection}) for (const [${key}, href] of Object.entries(alt.${collection})) elements.push(/* @__PURE__ */ jsx("link", {
\t\t\trel: "alternate",
\t\t\t${attribute},
\t\t\thref: resolveAlternateUrl(href, base, pathname, trailingSlash)
\t\t}, key++));`;
    if (!source.includes(original)) throw new Error("Alternate-link adapter shape changed");
    source = source.replace(original, `if (alt.${collection}) for (const [${key}, href] of Object.entries(alt.${collection})) {
      for (const value of Array.isArray(href) ? href : [href]) {
        const descriptor = value !== null && typeof value === "object" && !(value instanceof URL) ? value : { url: value };
        elements.push(jsx("link", { rel: "alternate", ${attribute}, title: descriptor.title,
          href: resolveAlternateUrl(descriptor.url, base, pathname, trailingSlash) }, key++));
      }
    }`);
  }
  return source;
}
