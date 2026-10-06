import { publicReferenceSchema, type PublicReference } from "./catalog";
import { EXPLORE_SOURCES } from "./explore-catalog";
import { SUPER_SIMPLE_CHANNEL_ID, SUPER_SIMPLE_FEED_URL } from "./youtube-feed";

function approvedFeed(exploreId: string, rssUrl: string) {
  const entry = EXPLORE_SOURCES.find((source) => source.id === exploreId);
  if (!entry) throw new Error(`Missing approved publisher directory entry: ${exploreId}`);
  return { id: entry.id.replace(/^explore:/, "public:"), name: entry.name, url: entry.url,
    rssUrl, description: entry.description, tags: [...entry.tags] };
}

/** Operator-approved public feeds. Approval to reference does not prove publisher ownership. */
export const APPROVED_PUBLIC_REFERENCES: PublicReference[] = [
  { id: "public:super-simple-songs", name: "Super Simple Songs - Kids Songs",
    url: `https://www.youtube.com/channel/${SUPER_SIMPLE_CHANNEL_ID}`, rssUrl: SUPER_SIMPLE_FEED_URL,
    description: "Official publisher video titles, dates and descriptions only; no video review, market demand, age-fit or learning-quality assessment.",
    tags: ["YouTube", "children", "English", "songs", "creator research"] },
  { id: "public:cloudflare-workers", name: "Cloudflare Workers", url: "https://blog.cloudflare.com/tag/workers/",
    rssUrl: "https://blog.cloudflare.com/tag/workers/rss/", description: "Official Cloudflare Workers engineering and product publications.",
    tags: ["Cloudflare", "Workers", "agents", "infrastructure"] },
  { id: "public:chip-huyen", name: "Chip Huyen", url: "https://huyenchip.com/",
    rssUrl: "https://huyenchip.com/feed.xml", description: "Independent foundational writing on AI engineering and production machine learning; publication dates may be older.",
    tags: ["AI engineering", "agents", "machine learning", "evaluation"] },
  { id: "public:lilian-weng", name: "Lilian Weng", url: "https://lilianweng.github.io/",
    rssUrl: "https://lilianweng.github.io/index.xml", description: "Independent technical explanations of language models, agent systems and machine learning research.",
    tags: ["LLM", "agents", "research", "evaluation"] },
  { id: "public:vicki-boykis", name: "Vicki Boykis", url: "https://vickiboykis.com/",
    rssUrl: "https://vickiboykis.com/index.xml", description: "Independent writing on machine learning engineering, data systems and practical AI.",
    tags: ["machine learning", "AI engineering", "data systems", "infrastructure"] },
  // Each added endpoint produced usable snapshots under the unchanged transport on 2026-10-06.
  // Directory-only publishers are deliberately absent. See the dated source catalog audit.
  approvedFeed("explore:openai-developers", "https://developers.openai.com/rss.xml"),
  approvedFeed("explore:deepmind", "https://deepmind.google/blog/rss.xml"),
  approvedFeed("explore:google-research", "https://research.google/blog/rss/"),
  approvedFeed("explore:ollama", "https://ollama.com/blog/rss.xml"),
  approvedFeed("explore:vllm", "https://vllm.ai/blog/rss.xml"),
  approvedFeed("explore:eugene-yan", "https://eugeneyan.com/rss/"),
  approvedFeed("explore:sebastian-raschka", "https://sebastianraschka.com/rss_feed.xml"),
  approvedFeed("explore:microsoft-research", "https://www.microsoft.com/en-us/research/feed/"),
  approvedFeed("explore:pytorch", "https://pytorch.org/feed/"),
  approvedFeed("explore:postgresql", "https://www.postgresql.org/news.rss"),
  approvedFeed("explore:docker", "https://www.docker.com/blog/feed"),
  approvedFeed("explore:duckdb", "https://duckdb.org/feed.xml"),
  approvedFeed("explore:tailscale", "https://tailscale.com/blog/index.xml"),
  approvedFeed("explore:spotify-engineering", "https://engineering.atspotify.com/feed"),
  approvedFeed("explore:netlify", "https://www.netlify.com/feed.xml"),
  approvedFeed("explore:supabase", "https://supabase.com/rss.xml"),
  approvedFeed("explore:rust", "https://blog.rust-lang.org/feed.xml"),
  approvedFeed("explore:go", "https://go.dev/blog/feed.atom"),
  approvedFeed("explore:stripe-blog", "https://stripe.com/blog/feed.rss"),
  approvedFeed("explore:x402", "https://x402.org/feed/"),
  approvedFeed("explore:bis", "https://www.bis.org/doclist/bis_fsi_publs.rss"),
  approvedFeed("explore:creative-commons", "https://creativecommons.org/feed/"),
  approvedFeed("explore:arxiv", "https://blog.arxiv.org/feed/"),
  approvedFeed("explore:doaj", "https://blog.doaj.org/feed/"),
  approvedFeed("explore:openalex", "https://blog.openalex.org/feed/"),
  approvedFeed("explore:wikimedia", "https://diff.wikimedia.org/feed/"),
].map((reference) => publicReferenceSchema.parse({ ...reference, active: true, items: [] }));
