import type { ReactNode } from "react";

/** Isolate complete technical tokens in an original without changing its bytes
 * or assigning language authority. Safe for both web and native React readers. */
export function originalTechnicalText(text: string): ReactNode {
  const token = String.raw`(?:https?://[^\s“”<>]+|<[^<>\r\n]+>|\{[^{}\r\n]+\})`;
  const matches = [...text.matchAll(new RegExp(`${token}(?:[ \\t]+${token})*`, "gu"))];
  if (!matches.length) return text;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index! > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(<bdi key={match.index} dir="ltr">{match[0]}</bdi>);
    cursor = match.index! + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
