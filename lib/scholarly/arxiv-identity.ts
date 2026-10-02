/** Bounded explicit version intent; never infer a version or accept API operators. */
export function questionArxivIds(question: string): string[] {
  return [...new Set([...question.matchAll(/(?:\barxiv\s*:?\s*|https:\/\/arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5}v[1-9]\d*)(?:\.pdf)?(?![\w]|\.[\w])/gi)]
    .map(match => match[1].toLowerCase()))].slice(0, 2);
}
