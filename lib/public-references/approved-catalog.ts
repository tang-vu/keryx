import { publicReferenceSchema, type PublicReference } from "./catalog";

/** Operator-approved public feeds. Approval to reference does not prove publisher ownership. */
export const APPROVED_PUBLIC_REFERENCES: PublicReference[] = [
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
].map((reference) => publicReferenceSchema.parse({ ...reference, active: true, items: [] }));
