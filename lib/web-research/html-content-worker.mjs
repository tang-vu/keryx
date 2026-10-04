import { parse, defaultTreeAdapter } from "parse5";
import { Readability } from "@mozilla/readability";
import JSDOMParser from "@mozilla/readability/JSDOMParser.js";
import { explicitVisibility } from "./html-visibility.mjs";

const MAX_ELEMENTS = 20000;
const MAX_NORMALIZED_BYTES = 500000;
const MAX_DEPTH = 256;
const INERT = new Set(["script", "style", "template"]);
const BLOCK = new Set(["address", "article", "aside", "blockquote", "br", "caption", "dd", "details", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tr", "ul"]);
const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Normalize with the HTML standard parser before Mozilla's XML-oriented DOM.
 * Non-rendered script/style/template/comment payloads are discarded here.
 * Inline visibility is handled below; no script or linked resource is run.
 */
function parseDocument(text) {
  let elements = 0;
  const tree = parse(text, {
    scriptingEnabled: false,
    treeAdapter: {
      ...defaultTreeAdapter,
      createElement(...args) {
        if (++elements > MAX_ELEMENTS) throw new Error("HTML element limit");
        return defaultTreeAdapter.createElement(...args);
      },
    },
  });
  const stack = [{ node: tree, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (depth > MAX_DEPTH) throw new Error("HTML depth limit");
    if (node.childNodes) {
      node.childNodes = node.childNodes.filter((child) => child.nodeName !== "#comment" && !INERT.has(child.tagName));
      for (const child of node.childNodes) stack.push({ node: child, depth: depth + 1 });
    }
  }
  return tree;
}

function normalizedDocument(text) {
  const tree = parseDocument(text);
  const articles = [], mains = [];
  let title = "";

  // XML serialization is deliberately separate from HTML parsing. Explicit end
  // tags and escaped literal text avoid JSDOMParser's HTML void/entity quirks.
  const pieces = [];
  let bytes = 0;
  const append = (piece) => {
    bytes += Buffer.byteLength(piece, "utf8");
    if (bytes > MAX_NORMALIZED_BYTES) throw new Error("HTML normalized byte limit");
    pieces.push(piece);
  };
  const pending = [{ node: tree, visible: true }];
  while (pending.length) {
    const { node, visible: inherited } = pending.pop();
    if (typeof node === "string") { append(node); continue; }
    if (node.nodeName === "#text") { if (inherited) append(escapeXml(node.value)); continue; }
    const { excluded, visible } = explicitVisibility(node, inherited);
    if (excluded) continue;
    if (node.tagName) {
      if (node.tagName === "title" && node.parentNode?.tagName === "head" && !title) title = visibleText(node);
      const role = node.attrs?.find((attr) => attr.name === "role")?.value;
      if (visible && (node.tagName === "article" || role === "article")) articles.push(node);
      if (visible && (node.tagName === "main" || role === "main")) mains.push(node);
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(node.tagName)) throw new Error("HTML tag unavailable");
      append(`<${node.tagName}`);
      for (const attr of node.attrs ?? []) {
        // Explicit visibility has already filtered the serialized text. Do not
        // let Readability's simpler style parser discard visible descendants.
        if (attr.name === "style") continue;
        const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
        if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) throw new Error("HTML attribute unavailable");
        append(` ${name}="${escapeXml(attr.value)}"`);
      }
      append(">");
      pending.push({ node: `</${node.tagName}>`, visible });
    }
    for (let index = (node.childNodes?.length ?? 0) - 1; index >= 0; index--) pending.push({ node: node.childNodes[index], visible });
  }
  // Main is the document's declared primary region; a related article card
  // inside or outside it must never override its surrounding qualifications.
  const region = mains.length === 1 ? mains[0] : mains.length === 0 && articles.length === 1 ? articles[0] : null;
  return { xml: pieces.join(""), title, region };
}

/** Retain document order, block/cell boundaries and code whitespace. Selecting
 * an explicit semantic region avoids heuristic loss of caveats and table heads.
 */
function visibleText(region) {
  const parts = [], stack = [{ node: region, pre: false, close: false, visible: true }];
  const boundary = () => { if (parts.length && !parts.at(-1).endsWith("\n")) parts.push("\n"); };
  while (stack.length) {
    const { node, pre, close, visible: inherited } = stack.pop();
    if (node.nodeName === "#text") {
      if (!inherited) continue;
      let value = pre ? node.value : node.value.replace(/\s+/gu, " ");
      if (!pre && (!parts.length || parts.at(-1).endsWith("\n"))) value = value.trimStart();
      if (value) parts.push(value);
      continue;
    }
    if (INERT.has(node.tagName) || node.nodeName === "#comment") continue;
    const { excluded, visible } = explicitVisibility(node, inherited);
    if (excluded) continue;
    if (close) {
      if (node.tagName === "td" || node.tagName === "th") parts.push(" | ");
      else if (BLOCK.has(node.tagName)) boundary();
      continue;
    }
    if (BLOCK.has(node.tagName)) boundary();
    stack.push({ node, pre, close: true, visible });
    for (let index = (node.childNodes?.length ?? 0) - 1; index >= 0; index--) {
      stack.push({ node: node.childNodes[index], pre: pre || node.tagName === "pre", close: false, visible });
    }
  }
  return parts.join("").replace(/^\n+|\n+$/g, "");
}

export function extractHtmlContent(text, finalUrl) {
  const normalized = normalizedDocument(text);
  let body, title = normalized.title;
  if (normalized.region) body = visibleText(normalized.region);
  else {
    const document = new JSDOMParser().parse(normalized.xml, finalUrl);
    const parsed = new Readability(document, { maxElemsToParse: MAX_ELEMENTS }).parse();
    if (typeof parsed?.content !== "string" || Buffer.byteLength(parsed.content, "utf8") > MAX_NORMALIZED_BYTES) throw new Error("HTML content unavailable");
    body = visibleText(parseDocument(parsed.content));
    title = parsed?.title || title;
  }
  if (!body || body.trim().length < 100) throw new Error("HTML content unavailable");
  return { text: body.slice(0, 60000), title: title?.replace(/\s+/gu, " ").trim().slice(0, 200) || new URL(finalUrl).hostname,
    finalUrl, kind: "html", truncated: body.length > 60000 };
}
