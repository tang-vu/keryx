// Deliberately inspect only explicit inline hiding, not computed browser CSS.
// Values follow https://www.w3.org/TR/css-display-3/#the-display-properties.
const GLOBAL = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);
const DISPLAY = new Set(["none", "contents", "inline-block", "inline-table", "inline-flex", "inline-grid", "table-row-group", "table-header-group", "table-footer-group", "table-row", "table-cell", "table-column-group", "table-column", "table-caption", "ruby-base", "ruby-text", "ruby-base-container", "ruby-text-container", "-webkit-box", "-webkit-inline-box"]);
const OUTSIDE = new Set(["block", "inline", "run-in"]);
const INSIDE = new Set(["flow", "flow-root", "table", "flex", "grid", "ruby"]);

function supportedValue(property, value) {
  if (GLOBAL.has(value)) return true;
  if (property === "visibility") return ["visible", "hidden", "collapse"].includes(value);
  if (property === "content-visibility") return ["visible", "hidden", "auto"].includes(value);
  if (DISPLAY.has(value)) return true;
  const keywords = value.split(/\s+/u);
  if (new Set(keywords).size !== keywords.length) return false;
  const outside = keywords.filter((word) => OUTSIDE.has(word));
  const inside = keywords.filter((word) => INSIDE.has(word));
  const list = keywords.includes("list-item");
  return outside.length <= 1 && inside.length <= 1
    && (!list || inside.every((word) => word === "flow" || word === "flow-root"))
    && outside.length + inside.length + Number(list) === keywords.length;
}

// Split declarations outside comments, quoted strings and functions so a CSS
// string containing "; display:none" cannot hide unrelated visible evidence.
function inlineHiding(style) {
  const declarations = [];
  let declaration = "", quote = "", depth = 0;
  for (let index = 0; index < style.length; index++) {
    const char = style[index];
    if (quote) {
      declaration += char;
      if (char === "\\") declaration += style[++index] ?? "";
      else if (char === quote) quote = "";
    } else if (char === "/" && style[index + 1] === "*") {
      const end = style.indexOf("*/", index + 2);
      if (end === -1) break;
      declaration += " ";
      index = end + 1;
    } else if (char === '"' || char === "'") {
      quote = char;
      declaration += char;
    } else if (char === "(") {
      depth++;
      declaration += char;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
      declaration += char;
    } else if (char === ";" && !depth) {
      declarations.push(declaration);
      declaration = "";
    } else declaration += char;
  }
  declarations.push(declaration);
  const values = new Map();
  for (const part of declarations) {
    const match = /^\s*(display|visibility|content-visibility)\s*:\s*([\s\S]*?)\s*$/i.exec(part);
    if (!match) continue;
    const property = match[1].toLowerCase();
    const important = /!\s*important\s*$/i.test(match[2]);
    const value = match[2].replace(/!\s*important\s*$/i, "").trim().toLowerCase();
    // Invalid declarations cannot reset a preceding valid declaration. Unknown
    // var()/env()/escaped values are not resolved and cannot cancel a known
    // static hide; extraction does not assert browser-computed visibility.
    if (!supportedValue(property, value)) continue;
    if (!values.get(property)?.important || important) values.set(property, { value, important });
  }
  return values;
}

const cache = new WeakMap();

/** HTML hidden and aria-hidden hide a subtree. Visibility is inherited and can
 * be reset by a visible child. Only supported literal declarations participate;
 * unknown CSS does not change an earlier supported value or get executed.
 */
export function explicitVisibility(node, inherited = true) {
  let state = cache.get(node);
  if (!state) {
    const attrs = new Map((node.attrs ?? []).map(({ name, value }) => [name, value]));
    const styles = inlineHiding(attrs.get("style") ?? "");
    state = {
      excluded: attrs.has("hidden") || attrs.get("aria-hidden")?.trim().toLowerCase() === "true"
        || styles.get("display")?.value === "none" || styles.get("content-visibility")?.value === "hidden",
      visibility: styles.get("visibility")?.value,
    };
    cache.set(node, state);
  }
  const visible = ["hidden", "collapse"].includes(state.visibility) ? false
    : ["visible", "initial"].includes(state.visibility) ? true : inherited;
  return { excluded: state.excluded, visible };
}
