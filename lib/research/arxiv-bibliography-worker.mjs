/** Bounded, inert raw-page metadata observation. No URL, script or subresource execution. */
import { parse } from "parse5";
import { explicitVisibility } from "../web-research/html-visibility.mjs";

const metadataNames = new Set(["citation_title", "citation_author", "citation_arxiv_id", "citation_date", "citation_doi", "citation_journal_title", "citation_publication_status"]);
const inactive = new Set(["script", "style", "template", "noscript"]);
function attributes(node) { return Object.fromEntries((node.attrs ?? []).map(attribute => [attribute.name, attribute.value])); }
function text(node) {
  const pending = [{ node, visible: true }], parts = []; let nodes = 0, length = 0;
  while (pending.length) {
    const { node: current, visible: inherited } = pending.pop(); if (++nodes > 25000) throw new Error("Metadata DOM limit");
    const attrs = attributes(current), visibility = explicitVisibility(current, inherited);
    if (inactive.has(current.tagName) || visibility.excluded || (attrs.class ?? "").split(/\s+/u).includes("descriptor")) continue;
    if (current.nodeName === "#text" && visibility.visible) { parts.push(current.value); length += current.value.length; if (length > 2000) return undefined; }
    if (current.childNodes) pending.push(...[...current.childNodes].reverse().map(child => ({ node: child, visible: visibility.visible })));
  }
  return parts.join("").replace(/\s+/gu, " ").trim();
}
function observe(html) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const metadata = {}, versions = [], titles = [], statuses = [];
  const pending = [{ node: document, inHead: false, visible: true, excluded: false, prose: false }]; let nodes = 0, units = 0;
  function unit(node, value, path, hidden = false) {
    if (++units > 150) throw new Error("Metadata field limit");
    const location = node.sourceCodeLocation;
    if (!location) throw new Error("Missing raw metadata provenance");
    const { startOffset: start, endOffset: end } = location;
    const rawExcerpt = end - start <= 1600 ? html.slice(start, end) : undefined;
    return { ...(hidden ? { unavailable: "hidden" } : typeof value === "string" && value.length <= 1200 ? { value } : { overBound: true }), path, start, end, ...(rawExcerpt ? { rawExcerpt } : {}) };
  }
  while (pending.length) {
    const { node, inHead, visible: inherited, excluded: inheritedExcluded, prose: inheritedProse } = pending.pop(); if (++nodes > 25000) throw new Error("Metadata DOM limit");
    const attrs = attributes(node), classes = (attrs.class ?? "").split(/\s+/u), visibility = explicitVisibility(node, inherited);
    const excluded = inheritedExcluded || visibility.excluded;
    const prose = inheritedProse || node.tagName === "table" || classes.some(name => ["abstract", "comments", "submission-history", "authors"].includes(name));
    if (inactive.has(node.tagName)) continue;
    // Still visit hidden head descendants solely to retain unavailable author
    // slots. Filtering them out would promote the next name into that position.
    if (node.tagName === "meta" && inHead && metadataNames.has(attrs.name)
      && (attrs.name === "citation_author" || !excluded && visibility.visible))
      (metadata[attrs.name] ??= []).push(unit(node, attrs.content ?? "", `head/meta[name="${attrs.name}"]/@content`, excluded || !visibility.visible));
    const parentClasses = (attributes(node.parentNode ?? {}).class ?? "").split(/\s+/u);
    const currentBreadcrumb = node.tagName === "strong" && parentClasses.includes("header-breadcrumbs-mobile");
    if (!excluded && visibility.visible && !prose && (classes.includes("arxiv-id") || classes.includes("arxivid") || currentBreadcrumb))
      versions.push(unit(node, text(node), currentBreadcrumb ? ".header-breadcrumbs-mobile > strong" : "[class~=arxiv-id], [class~=arxivid]"));
    if (!excluded && visibility.visible && !prose && node.tagName === "h1" && classes.includes("title")) titles.push(unit(node, text(node), "h1.title (descriptor excluded)"));
    if (!excluded && visibility.visible && !prose && classes.includes("withdrawal")) statuses.push(unit(node, text(node), "[class~=withdrawal]"));
    if (!excluded && visibility.visible && !prose && classes.includes("dateline")) statuses.push(unit(node, text(node), ".dateline (literal submission/version dates)"));
    if (node.childNodes) pending.push(...[...node.childNodes].reverse().map(child => ({ node: child, inHead: inHead || node.tagName === "head", visible: visibility.visible, excluded, prose })));
  }
  return { metadata, versions, titles, statuses };
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; if (input.length > 1508192) process.exit(1); });
process.stdin.on("end", () => {
  try {
    const html = JSON.parse(input);
    if (typeof html !== "string" || Buffer.byteLength(html, "utf8") > 250000) process.exit(1);
    const output = JSON.stringify(observe(html));
    if (Buffer.byteLength(output, "utf8") > 200000) process.exit(1);
    process.stdout.write(output);
  } catch { process.exit(1); }
});
