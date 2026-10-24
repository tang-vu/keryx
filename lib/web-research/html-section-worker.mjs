import { SAXParser } from "parse5-sax-parser";
import { finished } from "node:stream/promises";
import { createHash } from "node:crypto";
import { explicitVisibility } from "./html-visibility.mjs";

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const INERT = new Set(["script", "style", "template", "noscript", "svg", "math", "nav"]);
const UNSUPPORTED_PARENT = new Set("table thead tbody tfoot tr td th select option optgroup textarea title pre p".split(" "));
const CLOSE_P = new Set("address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre section table ul li dt dd".split(" "));
const escape = text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A conservative heading-section scanner, not an alternate HTML tree builder.
 * The complete byte-bounded input is scanned for duplicate anchors. Only strict,
 * balanced HTML and direct optional-end-tag cases are admitted; other repair shapes are
 * never guessed. The selected sibling range still uses the ordinary DOM parser.
 */
export async function selectHtmlSection(html, fragment) {
  if (typeof fragment !== "string" || !fragment || fragment.length > 200 || /[\u0000-\u0020\u007f]/u.test(fragment)) throw new Error("Unsupported section fragment");
  const parser = new SAXParser({ sourceCodeLocationInfo: true });
  const stack = [];
  let tokens = 0, matches = 0, pending, selection, title = "";
  const tick = () => { if (++tokens > 200000) throw new Error("HTML section scan limit"); };
  const sameParent = frame => frame === stack.at(-1);
  const pop = offset => {
    const frame = stack.pop();
    if (selection && selection.end === undefined && frame === selection.parent) selection.end = offset;
    return frame;
  };
  // Support only direct optional-end-tag cases. An intervening open inline
  // element would require tree repair/adoption and remains unsupported.
  const closeOptional = (tag, offset, ending) => {
    if (CLOSE_P.has(tag) && !ending && stack.some(frame => frame.tagName === "p")) {
      if (stack.at(-1).tagName !== "p") throw new Error("Unsupported paragraph repair");
      pop(offset);
    }
    const top = () => stack.at(-1)?.tagName;
    if (ending && top() === "p" && stack.at(-2)?.tagName === tag) pop(offset);
    if ((!ending && tag === "li" || ending && ["ul", "ol", "menu"].includes(tag)) && top() === "li") pop(offset);
    if ((!ending && ["dt", "dd"].includes(tag) || ending && tag === "dl") && ["dt", "dd"].includes(top())) pop(offset);
    if ((!ending && ["td", "th"].includes(tag) || ending && ["tr", "tbody", "thead", "tfoot", "table"].includes(tag)) && ["td", "th"].includes(top())) pop(offset);
    if ((!ending && tag === "tr" || ending && ["tbody", "thead", "tfoot", "table"].includes(tag)) && top() === "tr") pop(offset);
    if ((!ending && ["tbody", "thead", "tfoot"].includes(tag) || ending && tag === "table") && ["tbody", "thead", "tfoot"].includes(top())) pop(offset);
    if ((!ending && ["option", "optgroup"].includes(tag) || ending && ["select", "optgroup"].includes(tag)) && top() === "option") pop(offset);
    if ((!ending && tag === "optgroup" || ending && tag === "select") && top() === "optgroup") pop(offset);
    if ((!ending && tag === "body" || ending && tag === "html") && top() === "head") pop(offset);
    if (ending && tag === "html" && top() === "body") pop(offset);
  };
  parser.on("startTag", token => {
    tick();
    const { tagName, attrs, sourceCodeLocation: location } = token;
    closeOptional(tagName, location.startOffset, false);
    const parent = stack.at(-1);
    const own = explicitVisibility(token, parent?.visible ?? true);
    const excluded = Boolean(parent?.excluded || own.excluded || INERT.has(tagName));
    const visible = own.visible;
    const level = /^h[1-6]$/u.test(tagName) ? Number(tagName[1]) : 0;
    const anchor = attrs.some(attr => (attr.name === "id" || tagName === "a" && attr.name === "name") && attr.value === fragment);
    if (anchor) matches++;
    if (matches > 1) throw new Error("Ambiguous section anchor");
    if (selection && selection.end === undefined && level && !excluded && visible && level <= selection.level) {
      if (!sameParent(selection.parent)) throw new Error("Unsupported section boundary");
      selection.end = location.startOffset;
    }
    if (pending && !(tagName === "a" && anchor)) {
      if (level && sameParent(pending.parent) && !excluded && visible && !selection) {
        selection = { start: location.startOffset, level, parent };
      }
      pending = undefined;
    }
    if (anchor && !excluded && visible && !selection) {
      // Ancestor visibility must be representable without losing inheritance
      // when the selected siblings are placed in the isolated main region.
      if (stack.some(frame => !frame.visible || frame.excluded || UNSUPPORTED_PARENT.has(frame.tagName))) throw new Error("Unsupported section ancestry");
      if (level) selection = { start: location.startOffset, level, parent };
      else if (tagName !== "a") throw new Error("Anchor does not name a heading");
    }
    if (selection && selection.end === undefined && location.endOffset - selection.start > 500000) throw new Error("HTML section byte limit");
    const foreign = parent?.foreign || tagName === "svg" || tagName === "math";
    if (token.selfClosing && !VOID.has(tagName) && !foreign) throw new Error("Unsupported HTML self-closing element");
    if (!VOID.has(tagName) && !(foreign && token.selfClosing)) {
      if (stack.length >= 256) throw new Error("HTML depth limit");
      stack.push({ tagName, attrs, visible, excluded, foreign, anchor, parent, empty: true });
    }
  });
  parser.on("endTag", token => {
    tick();
    closeOptional(token.tagName, token.sourceCodeLocation.startOffset, true);
    const frame = pop(token.sourceCodeLocation.startOffset);
    if (!frame || frame.tagName !== token.tagName) throw new Error("Unsupported unbalanced HTML", {
      cause: { expected: frame?.tagName, observed: token.tagName, offset: token.sourceCodeLocation.startOffset },
    });
    if (frame.anchor && frame.tagName === "a" && !frame.excluded && frame.visible && frame.empty && !selection) pending = { parent: frame.parent };
  });
  parser.on("text", token => {
    tick();
    if (token.text.trim()) {
      if (pending) pending = undefined;
      for (const frame of stack) if (frame.anchor) frame.empty = false;
    }
    if (stack.at(-1)?.tagName === "title" && title.length < 200) title += token.text.slice(0, 200 - title.length);
  });
  parser.on("comment", tick);
  parser.on("doctype", tick);
  const completion = finished(parser);
  try { parser.end(html); await completion; }
  catch (error) { parser.destroy(); await completion.catch(() => {}); throw error; }
  if (stack.length || matches !== 1 || !selection) throw new Error("Section heading unavailable");
  const end = selection.end ?? html.length;
  const body = html.slice(selection.start, end);
  if (Buffer.byteLength(body, "utf8") > 500000) throw new Error("HTML section byte limit");
  return {
    html: `<html><head><title>${escape(title)}</title></head><body><main>${body}</main></body></html>`,
    scope: { format: "keryx-html-section-scope-v1", fragment, headingLevel: selection.level,
      htmlStart: selection.start, htmlEnd: end, documentCharacters: html.length,
      documentSha256: createHash("sha256").update(html, "utf8").digest("hex") },
  };
}
