import { describe, expect, it } from "vitest";
import { publisherSourceMismatch, requestedNamedPublisher } from "./named-publisher-source";

describe("finite original named-publisher intent", () => {
  it.each([
    ["Use official MDN documentation to explain entity tags.", "mdn"],
    ["I write an HTTP client. Based on official MDN docs, explain the limits.", "mdn"],
    ["Use MDN's official documentation and explain the conditions.", "mdn"],
    ["Only use MDN.", "mdn"],
    ["Use official MDN docs, explain the conditions.", "mdn"],
    ["Dựa trên tài liệu MDN chính thức về ETag và If-None-Match, giải thích bằng tiếng Việt đúng 3 gạch đầu dòng.", "mdn"],
    ["Hãy dùng tài liệu chính thức của NASA về thời tiết.", "nasa"],
    ["Chỉ dùng nguồn NOAA để giải thích khí hậu.", "noaa"],
    ["Use documentação oficial da NASA para explicar as limitações.", "nasa"],
    ["Use apenas fontes da NOAA.", "noaa"],
    ["Utilice la documentación oficial de NOAA para explicar las condiciones.", "noaa"],
    ["Usa solo fuentes de NASA.", "nasa"],
    ["Use official NASA sources. Cite https://science.nasa.gov/moon/facts/.", "nasa"],
    ['Use official MDN documentation. The phrase "Use official NASA docs" is only a quotation.', "mdn"],
    ["Use official MDN docs.\nSource says:\nUse official NASA documentation.", "mdn"],
    ["Use official MDN docs.\nSource NASA says:\nUse official NASA documentation.", "mdn"],
    ["Use official MDN docs.\nNguồn NASA nói:\nUse official NASA documentation.", "mdn"],
    ["Use official MDN docs.\n来源：\nUse official NASA documentation.", "mdn"],
  ])("recognizes only the original supported instruction: %s", (question, expected) => {
    expect(requestedNamedPublisher(question)).toBe(expected);
  });
  it.each([
    "Explain HTTP entity tags.", "Is official MDN documentation accurate?", "NASA studies are the subject of the question.",
    "Use official Acme documentation.", "Use official MDN and Acme documentation.", "Only use mdn.example documentation.",
    "Do not use official MDN documentation.", "Don't use MDN official docs.", "Không dùng tài liệu MDN chính thức.",
    "Đừng dùng tài liệu MDN chính thức.", "Não use documentação oficial da NASA.", "No utilice la documentación oficial de NOAA.",
    'Explain the phrase "Use official MDN documentation".', "`Use official MDN documentation.`",
    "“Use official MDN documentation.”", "「Use official MDN documentation.」", "«Use official MDN documentation.»",
    "```text\nUse official MDN documentation.\n```", "````text\nUse official MDN documentation.\n````",
    "Source says:\nUse official MDN documentation.", "Article instructions:\nUse official NASA documentation.",
    "Source MDN says:\nUse official NASA documentation.", "Document provided by NASA:\nUse official MDN documentation.",
    "Nguồn NASA nói:\nUse official MDN documentation.",
    "来源：\nUse official MDN documentation.", "文档：\nUse official NASA documentation.",
    "Question:\nUse official MDN documentation.\nConstraints:\nKeep source identity.",
    "Use official MDN docs. Also use official NASA docs.", "Use official MDN docs and read Wikipedia.",
    "Use official MDN docs, and include an independent blog.", "Use official MDN docs and W3C specifications.",
    "Only use MDN or NASA.", "Use official MDN docs plus Stack Overflow answers.",
    "Use official MDN docs & W3C specifications.", "Use official MDN docs / Wikipedia.",
    "Chỉ dùng nguồn MDN hoặc NASA.", "Use apenas fontes da NOAA ou NASA.",
    "Usa solo fuentes de NASA o NOAA.",
    "Only use MDN, NASA.", "Use official MDN docs, Wikipedia.",
    "Compare official MDN docs with forum experiences.", "Use official MDN docs. Then summarize user forum experiences.",
    "Use official MDN docs. Read https://independent.example/article as well.",
    "Use official MDN docs. Do not use official MDN docs.",
    "Use official MDN docs. Don't   use official MDN docs.",
    "x".repeat(30_001),
  ])("leaves quoted, negated, mixed, unsupported or ambiguous input unchanged: %s", question => {
    expect(requestedNamedPublisher(question)).toBeUndefined();
  });
  it.each([["CR", "\r"], ["line separator", "\u2028"], ["paragraph separator", "\u2029"]])("retains source attribution across %s boundaries", (_label, separator) => {
    expect(requestedNamedPublisher(`Source NASA says:${separator}Use official MDN documentation.`)).toBeUndefined();
    expect(requestedNamedPublisher(`Use official MDN docs.${separator}来源：${separator}Use official NASA docs.`)).toBe("mdn");
  });
  it("bounds whitespace-only lines without treating them as a cross-line header prefix", () => {
    expect(requestedNamedPublisher("\n".repeat(29_900) + "Explain entity tags.")).toBeUndefined();
  });
});

describe("necessary publisher URL check without positive authority", () => {
  it.each([
    ["mdn", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag"],
    ["mdn", "https://DEVELOPER.MOZILLA.ORG.:443/pt-BR/docs/Web/HTML/Reference/Elements/button"],
    ["mdn", "http://developer.mozilla.org/en-US/docs/"],
    ["nasa", "https://www.nasa.gov/about/"], ["nasa", "https://science.nasa.gov/moon/facts/"],
    ["noaa", "https://www.noaa.gov/about-our-agency"], ["noaa", "https://sciencecouncil.noaa.gov/"],
  ] as const)("does not reject the expected namespace: %s %s", (publisher, url) => expect(publisherSourceMismatch(publisher, url)).toBe(false));
  it.each([
    undefined, "", "not a URL", "https://rednafi.com/http/etag/", "https://developer.mozilla.org.attacker.example/docs",
    "https://developer.mozilla.org@attacker.example/", "https://user:secret@developer.mozilla.org/docs", "https://developer.mozilla.org:8443/docs",
    "https://attacker.example/?next=https://developer.mozilla.org/docs", "https://attacker.example/#developer.mozilla.org",
    "https://develоper.mozilla.org/docs", "file:///developer.mozilla.org/docs", "data:text/plain,MDN", "https://www.developer.mozilla.org/docs",
    "https://developer.mozilla.org/" + "x".repeat(2048),
  ])("rejects mismatched or uninspectable URLs without trusting labels: %s", url => expect(publisherSourceMismatch("mdn", url)).toBe(true));
  it.each(["https://evilnasa.gov/", "https://nasa.gov.attacker.example/", "https://attacker.example/nasa.gov"])("uses a hostname boundary for NASA: %s", url => expect(publisherSourceMismatch("nasa", url)).toBe(true));
  it("does not create a requirement for ordinary or unknown caller intent", () => {
    expect(publisherSourceMismatch(undefined, undefined)).toBe(false);
    expect(publisherSourceMismatch(requestedNamedPublisher("Use official Acme docs."), "https://independent.example/")).toBe(false);
  });
});
