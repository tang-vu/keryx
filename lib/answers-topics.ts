/**
 * Topic facets for the answer archive: the corpus indexes itself.
 *
 * The archive is one flat list of every question Keryx has answered, which stops being browsable
 * long before it stops growing. Rather than hand-curating categories (they would rot the moment a
 * new beat appears) or paying an LLM to tag hundreds of entries (non-deterministic, and it would
 * re-tag differently on every rebuild), topics are derived from the questions themselves: a token
 * that shows up across enough distinct questions IS a topic this corpus covers.
 *
 * Pure + deterministic so the same corpus always yields the same URLs — a topic page whose slug
 * drifted between rebuilds would hand crawlers a fresh 404 every time.
 */

/** Question words, auxiliaries, prepositions, and the generic verbs that survive them. None of
 *  these describes a subject, and each is common enough to otherwise dominate the facet list. */
const STOP = new Set(
  (
    "the a an is are was were be been being have has had do does did will would could should may " +
    "might can shall must to of in for on with at by from as into about it its this that these " +
    "those and or not no what how why when where which who whom whose any some all each every " +
    "much many more most other such only own same than too very just but if then so up out over " +
    "under between during after before while both few own s t don now here there their them they " +
    "we our you your i me my he she his her us against across per via within without upon " +
    // Generic verbs and framing words: they describe the shape of a question, never its subject.
    "make makes making made use uses used using work works working get gets getting give gives " +
    "take takes best good better worth need needs affect affects improve improves optimize " +
    "optimizes enable enables let lets keep keeps become becomes happen happens mean means " +
    "matter matters compare compares handle handles based real actually still even also always " +
    "never really thing things way ways lot different new old big small long short high low"
  ).split(" "),
);

/**
 * Fold a plural onto its singular so "agents" and "agent" are one topic rather than two competing
 * facets. Deliberately crude — only long tokens are touched, which keeps "gas", "news", and "apis"
 * intact where a real stemmer would mangle them.
 */
function stem(token: string): string {
  if (token.length >= 6 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length >= 5 && token.endsWith("s") && !/(ss|us|is)$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

/** The topic tokens a question contributes, deduped. Digits survive: `x402` and `402` are subjects. */
export function topicTokens(question: string): Set<string> {
  const out = new Set<string>();
  for (const word of question.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (word.length < 3 || STOP.has(word)) continue;
    const s = stem(word);
    if (s.length < 3 || STOP.has(s)) continue;
    out.add(s);
  }
  return out;
}

export interface ArchiveTopic {
  /** URL segment — the stemmed token. Stable across rebuilds for a stable corpus. */
  slug: string;
  /** How the corpus itself writes it (most common surface form), e.g. "USDC", "agents". */
  label: string;
  /** Distinct archive entries under this topic. */
  count: number;
}

export interface TopicOptions {
  /** Entries a token must appear in before it earns a facet. Below this it is noise. */
  minCount?: number;
  /** Cap on facets shown — a wall of chips is as unbrowsable as the flat list it replaces. */
  limit?: number;
}

/**
 * Rank the corpus's topics by how many distinct questions they cover.
 *
 * A token present in most of the corpus is dropped however common it is: a facet that returns
 * nearly everything narrows nothing, and on a single-subject corpus that is exactly what the
 * subject's own name would do.
 */
export function buildTopics(
  entries: { question: string }[],
  { minCount = 3, limit = 24 }: TopicOptions = {},
): ArchiveTopic[] {
  const docCount = new Map<string, number>();
  // Surface forms per stem, so the chip reads the way people actually write the word.
  const surfaces = new Map<string, Map<string, number>>();

  for (const e of entries) {
    for (const token of topicTokens(e.question)) {
      docCount.set(token, (docCount.get(token) ?? 0) + 1);
    }
    // Surface tally is separate: it counts occurrences, not documents.
    for (const word of e.question.split(/[^A-Za-z0-9]+/)) {
      if (!word) continue;
      const token = stem(word.toLowerCase());
      if (!docCount.has(token)) continue;
      const forms = surfaces.get(token) ?? new Map<string, number>();
      forms.set(word, (forms.get(word) ?? 0) + 1);
      surfaces.set(token, forms);
    }
  }

  const ubiquitous = entries.length * 0.6;

  return [...docCount.entries()]
    .filter(([, n]) => n >= minCount && n <= ubiquitous)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([slug, count]) => {
      const forms = [...(surfaces.get(slug) ?? new Map())].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      );
      return { slug, label: forms[0]?.[0] ?? slug, count };
    });
}

/** Entries filed under one topic slug, in the order they were given. */
export function filterByTopic<T extends { question: string }>(entries: T[], slug: string): T[] {
  const want = stem(slug.toLowerCase());
  return entries.filter((e) => topicTokens(e.question).has(want));
}
