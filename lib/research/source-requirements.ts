/**
 * Narrow negative source-role gate. Recognizing a discussion URL never establishes the
 * authority, authorship, truth or suitability of another URL. In particular, a publisher's
 * domain and a creator ownership claim do not turn a forum post into official documentation.
 */
export function requestsOfficialDocumentation(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();
  // A positive request for discussion evidence makes this a mixed-source task.
  // Its documentation targets can still carry their own requirement below.
  const discussionRequest = /(?:^|[.!?;]\s+|\b(?:and|then|also|va|roi)\s+)(?:(?:then|also)\s+)?(?:compare|summarize|include|consider|review|read|contrast|so sanh|tom tat|doc|xem xet)\b[^.!?;]{0,160}\b(?:forums?|discussions?|community|user experiences|dien dan|thao luan|kinh nghiem nguoi dung)\b/u;
  if (discussionRequest.test(normalized)) return false;
  // Only explicit instruction forms at a sentence boundary. A mere mention, quoted example,
  // negated instruction, or comparison with forum opinions is not a blanket source constraint.
  const boundary = "(?:^|[.!?]\\s+)";
  const productWords = "(?:\\s+[\\p{L}\\d_.’'-]+){0,6}";
  return new RegExp(boundary + "(?:please\\s+)?(?:use|using|only use|based on|according to|consult|cite|rely on)\\s+(?:the\\s+)?official" + productWords + "\\s+(?:documentation|docs|manuals?)\\b", "u").test(normalized)
    || new RegExp(boundary + "(?:hay\\s+)?(?:dung|su dung|chi dung|dua tren|dua vao|theo|tham khao|trich dan)\\s+(?:cac\\s+)?(?:tai lieu|huong dan)" + productWords + "\\s+chinh thuc\\b", "u").test(normalized);
}

/** Known discussion URL shapes, not a general classifier or an allowlist of official sites. */
export function isRecognizedDiscussionUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const pathname = decodeURIComponent(url.pathname).toLowerCase();
    if (host === "sqlite.org") return /^\/forum\/(?:info|forumpost|forumpostedit|forumpostreply)(?:\/|$)/.test(pathname);
    if (host === "github.com") return /^\/[^/]+\/[^/]+\/(?:issues|discussions)(?:\/|$)/.test(pathname);
    if (host === "reddit.com" || host.endsWith(".reddit.com")) return /^\/(?:r\/[^/]+\/)?comments\//.test(pathname);
    if (["stackoverflow.com", "serverfault.com", "superuser.com", "askubuntu.com"].includes(host) ||
      host.endsWith(".stackexchange.com")) return /^\/(?:questions|q|a)\//.test(pathname);
    return /^(?:discuss|discussion|discussions|forum|forums|community)\./.test(host) && /^\/t\//.test(pathname);
  } catch { return false; }
}

export function discussionDoesNotMeetDocumentRequest(question: string, itemUrl: string | undefined, claim?: string): boolean {
  return isRecognizedDiscussionUrl(itemUrl) &&
    (requestsOfficialDocumentation(question) || !!claim && requestsOfficialDocumentation(claim));
}
