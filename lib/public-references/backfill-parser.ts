import { SaxesParser } from "saxes";
import { parse, parseFragment, defaultTreeAdapter, type DefaultTreeAdapterMap } from "parse5";

export const BACKFILL_USER_AGENT = "Keryx-FeedCheck";
export const DISCOVERY_MAX_BYTES = 2 * 1024 * 1024;
export interface DiscoveredArticle { url: string; title?: string; summary?: string; content?: string; publishedAt?: string }
export interface DiscoveryDocument { articles: DiscoveredArticle[]; pages: Array<{ url: string; kind: "feed" | "sitemap" | "page" }>; historical: boolean }
export interface RobotsPolicy { rules: Array<{ allow: boolean; pattern: string }>; sitemaps: string[]; delayMs: number }

function bounded(text: string): void {
  if (Buffer.byteLength(text, "utf8") > DISCOVERY_MAX_BYTES) throw new Error("discovery-byte-limit");
}
function inertParserOptions() {
  let elements = 0;
  return { scriptingEnabled: false, treeAdapter: {
    ...defaultTreeAdapter,
    createElement: (...args: Parameters<typeof defaultTreeAdapter.createElement>) => {
      if (++elements > 20_000) throw new Error("html-complexity-limit");
      return defaultTreeAdapter.createElement(...args);
    },
  } };
}
/** Inert parse5 trees; neither scripts, subresources nor embedded XML are executed. */
export function plainMarkup(value: string): string {
  bounded(value);
  const root = parseFragment(value, inertParserOptions());
  const out: string[] = [];
  const stack: DefaultTreeAdapterMap["node"][] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if ("tagName" in node && ["script", "style", "template", "noscript"].includes(node.tagName)) continue;
    if ("value" in node) out.push(node.value);
    if ("childNodes" in node) stack.push(...[...node.childNodes].reverse());
  }
  return out.join(" ").replace(/\s+/gu, " ").trim();
}

/** RFC 9309 groups and longest matching rules; Crawl-delay is honored as an extension. */
export function parseRobots(text: string): RobotsPolicy {
  bounded(text);
  const groups: Array<{ agents: string[]; rules: RobotsPolicy["rules"]; delayMs: number }> = [];
  let group: (typeof groups)[number] | undefined;
  let hasDirectives = false;
  const sitemaps: string[] = [];
  for (const raw of text.split(/\r?\n|\r/u)) {
    const line = raw.replace(/#.*$/u, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (key === "sitemap" && value) { sitemaps.push(value); continue; }
    if (key === "user-agent") {
      if (!group || hasDirectives) { group = { agents: [], rules: [], delayMs: 0 }; groups.push(group); hasDirectives = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && (key === "allow" || key === "disallow")) {
      hasDirectives = true;
      if (value.startsWith("/")) {
        if (value.length > 2048) throw new Error("robots-complexity-limit");
        group.rules.push({ allow: key === "allow", pattern: value });
      }
    } else if (group && key === "crawl-delay") {
      hasDirectives = true;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) group.delayMs = Math.max(group.delayMs, Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(seconds * 1000)));
    }
  }
  const exact = groups.filter(g => g.agents.includes(BACKFILL_USER_AGENT.toLowerCase()));
  const selected = exact.length ? exact : groups.filter(g => g.agents.includes("*"));
  return { rules: selected.flatMap(g => g.rules), sitemaps: [...new Set(sitemaps)], delayMs: Math.max(0, ...selected.map(g => g.delayMs)) };
}
function robotsOctets(value: string): string {
  return value.replace(/%[a-f0-9]{2}|[^\x00-\x7f]/giu, token => {
    if (!token.startsWith("%")) return encodeURIComponent(token);
    const char = String.fromCharCode(Number.parseInt(token.slice(1), 16));
    return /^[a-z0-9._~-]$/iu.test(char) ? char : token.toUpperCase();
  });
}
/** Greedy glob matching avoids attacker-controlled regular expressions. */
function ruleMatches(pattern: string, path: string, budget: { remaining: number }): boolean {
  const end = pattern.endsWith("$");
  const glob = robotsOctets(end ? pattern.slice(0, -1) : `${pattern}*`);
  const target = robotsOctets(path);
  let p = 0, t = 0, star = -1, saved = 0;
  while (t < target.length) {
    if (--budget.remaining < 0) throw new Error("robots-complexity-limit");
    if (p < glob.length && glob[p] === target[t]) { p++; t++; }
    else if (glob[p] === "*") { star = p++; saved = t; }
    else if (star >= 0) { p = star + 1; t = ++saved; }
    else return false;
  }
  while (glob[p] === "*") p++;
  return p === glob.length;
}
export function robotsAllows(policy: RobotsPolicy, url: string): boolean {
  const parsed = new URL(url);
  if (parsed.pathname === "/robots.txt") return true;
  let length = -1, allow = true;
  const budget = { remaining: 1_000_000 };
  for (const rule of policy.rules) {
    if (!ruleMatches(rule.pattern, `${parsed.pathname}${parsed.search}`, budget)) continue;
    const specificity = Buffer.byteLength(robotsOctets(rule.pattern.replace(/[*$]/gu, "")));
    if (specificity > length || (specificity === length && rule.allow)) { length = specificity; allow = rule.allow; }
  }
  return allow;
}

/** No DTD, external entities or entity expansion. Malformed/overdeep documents fail atomically. */
export function parseDiscoveryXml(xml: string, baseUrl: string): DiscoveryDocument {
  bounded(xml);
  const result: DiscoveryDocument = { articles: [], pages: [], historical: false };
  const parser = new SaxesParser({ xmlns: true });
  const stack: Array<{ name: string; text: string; attrs: Record<string, string> }> = [];
  let root = "", nodes = 0;
  let item: Record<string, string> | undefined;
  const absolute = (raw: string) => { try { return new URL(raw, baseUrl).href; } catch { return ""; } };
  parser.on("doctype", () => { throw new Error("xml-doctype-refused"); });
  parser.on("error", () => { throw new Error("malformed-xml"); });
  parser.on("opentag", tag => {
    if (++nodes > 100_000 || stack.length >= 64) throw new Error("xml-complexity-limit");
    const attrs = Object.fromEntries(Object.values(tag.attributes).map(attr => [attr.local, attr.value]));
    stack.push({ name: tag.local, text: "", attrs });
    if (!root) root = tag.local;
    if (tag.local === "item" || tag.local === "entry") item = {};
    if (tag.local === "link" && attrs.href) {
      const href = absolute(attrs.href), rel = attrs.rel ?? "alternate";
      if (item && rel === "alternate") item.link = href;
      else if (!item && ["next", "prev-archive", "next-archive"].includes(rel)) {
        result.pages.push({ url: href, kind: "feed" }); result.historical = true;
      }
    }
  });
  const text = (value: string) => { if (stack.length) stack[stack.length - 1]!.text += value; };
  parser.on("text", text); parser.on("cdata", text);
  parser.on("closetag", () => {
    const node = stack.pop()!;
    const parent = stack[stack.length - 1]?.name;
    if (item && ["title", "description", "summary", "content", "encoded", "published", "updated", "pubDate", "link"].includes(node.name)) {
      if (node.name !== "link" || !item.link) item[node.name] = node.text.trim();
    }
    if (node.name === "loc" && (parent === "sitemap" || parent === "url")) {
      const url = absolute(node.text.trim());
      if (parent === "sitemap") result.pages.push({ url, kind: "sitemap" });
      else result.articles.push({ url });
      result.historical = true;
    }
    if ((node.name === "item" || node.name === "entry") && item) {
      if (item.link) {
        const rawDate = item.published ?? item.pubDate ?? item.updated;
        const date = rawDate ? new Date(rawDate) : undefined;
        const body = plainMarkup(item.encoded ?? item.content ?? item.description ?? item.summary ?? "").slice(0, 60_000);
        result.articles.push({ url: absolute(item.link), title: plainMarkup(item.title ?? "").slice(0, 1000),
          summary: plainMarkup(item.summary ?? item.description ?? "").slice(0, 100_000), content: body,
          ...(date && Number.isFinite(date.getTime()) ? { publishedAt: date.toISOString() } : {}) });
      }
      item = undefined;
    }
    // Preserve mixed inline Atom text without duplicating whole entries in parent buffers.
    if (stack.length && !["item", "entry", "url", "sitemap"].includes(node.name)) stack[stack.length - 1]!.text += node.text;
  });
  parser.write(xml).close();
  if (!["rss", "feed", "RDF", "sitemapindex", "urlset"].includes(root)) throw new Error("unsupported-xml");
  return result;
}

/** Follow publisher-declared archives/pagination, and article links in editorial containers. */
export function parseArchiveHtml(html: string, baseUrl: string, landing: boolean): DiscoveryDocument {
  bounded(html);
  const result: DiscoveryDocument = { articles: [], pages: [], historical: false };
  const root = parse(html, inertParserOptions());
  const stack: Array<{ node: DefaultTreeAdapterMap["node"]; editorial: boolean; depth: number }> = [{ node: root, editorial: false, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    if (++nodes > 100_000) throw new Error("html-complexity-limit");
    const { node, editorial, depth } = stack.pop()!;
    if (depth > 256) throw new Error("html-complexity-limit");
    if ("tagName" in node && ["script", "style", "template", "noscript"].includes(node.tagName)) continue;
    const navigation = "tagName" in node && ["nav", "footer", "header"].includes(node.tagName);
    const role = "attrs" in node ? node.attrs.find(attr => attr.name === "role")?.value : undefined;
    const inEditorial = !navigation && (editorial || ("tagName" in node && ["main", "article"].includes(node.tagName)) || role === "main" || role === "article");
    if ("tagName" in node && ["a", "link"].includes(node.tagName)) {
      const attrs = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]));
      if (attrs.href) {
        let url = "";
        try { url = new URL(attrs.href, baseUrl).href; } catch { /* inert invalid link */ }
        const rel = (attrs.rel ?? "").split(/\s+/u);
        const labels: string[] = [];
        const labelStack: DefaultTreeAdapterMap["node"][] = [node];
        while (labelStack.length) {
          const child = labelStack.pop()!;
          if ("value" in child) labels.push(child.value);
          if ("childNodes" in child) labelStack.push(...[...child.childNodes].reverse());
        }
        const label = labels.join(" ").replace(/\s+/gu, " ").trim();
        const location = new URL(url || baseUrl);
        const directory = location.pathname.replace(/\/index\.(?:html?|php)$/iu, "").replace(/\/$/u, "");
        // These are actual publisher anchors, never synthesized section URLs. The strict last
        // directory component excludes article details and newsletter/account/navigation tools.
        const editorialIndex = landing && location.origin === new URL(baseUrl).origin &&
          !/\/(?:accounts?|logins?|signin|sign-in|signup|sign-up|newsletters?|subscribe|subscriptions?|settings|search|register)(?:\/|$)/iu.test(location.pathname) &&
          !/\b(?:account|login|sign in|sign up|newsletter|subscribe|settings|search|register)\b/iu.test(label) &&
          /\/(?:articles?|blogs?|weblogs?|news|posts?|essays?|writings?|publications)$/iu.test(directory) &&
          /\b(?:articles?|blogs?|weblogs?|news|posts?|essays?|writings?|publications)\b/iu.test(label);
        if (rel.includes("sitemap")) { result.pages.push({ url, kind: "sitemap" }); result.historical = true; }
        else if (editorialIndex || rel.some(value => ["next", "prev", "archive"].includes(value)) || /\b(archives?|older|previous)\b/iu.test(label) || /\/(archives?)(?:\/|$)/iu.test(location.pathname)) {
          result.pages.push({ url, kind: "page" }); result.historical = true;
        } else if (!landing && inEditorial && node.tagName === "a" && label && attrs.href !== "#" && !attrs.href.startsWith("#")) {
          result.articles.push({ url, title: label.slice(0, 1000) });
        }
      }
    }
    if ("childNodes" in node) for (const child of [...node.childNodes].reverse()) stack.push({ node: child, editorial: inEditorial, depth: depth + 1 });
  }
  return result;
}
