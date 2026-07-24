/**
 * Topic facets for the answer archive. Pins the properties the public URLs depend on: a topic
 * page's slug must not drift between rebuilds, a facet must actually narrow the corpus, and
 * filtering must find the same entries that were counted.
 */

import { describe, expect, it } from "vitest";
import { buildTopics, filterByTopic, topicTokens } from "./answers-topics";

const q = (question: string) => ({ question });

const CORPUS = [
  q("How do x402 nanopayments reward cited creators?"),
  q("How fast does x402 settle payments on Arc?"),
  q("What is x402 and how do nanopayments settle on Arc?"),
  q("How do autonomous agents pay for content per use with stablecoins?"),
  q("How should an agent decide when a cheaper source is good enough?"),
  q("Why is instant onchain settlement important for machine-to-machine commerce?"),
  q("What is the role of batching in gas-efficient micropayment settlement?"),
  q("How does compost improve soil in a small garden?"),
];

describe("topicTokens", () => {
  it("keeps subjects and drops question framing", () => {
    const t = topicTokens("How does x402 settle payments on Arc?");
    expect([...t].sort()).toEqual(["arc", "payment", "settle", "x402"]);
  });

  it("folds plurals onto one topic but leaves short words alone", () => {
    expect(topicTokens("agents and agent")).toEqual(new Set(["agent"]));
    // Naive de-pluralising would turn these into "ga", "new", and "statu".
    expect(topicTokens("gas news status")).toEqual(new Set(["gas", "news", "status"]));
  });

  it("treats digits as part of a subject", () => {
    expect(topicTokens("What is x402?")).toEqual(new Set(["x402"]));
  });
});

describe("buildTopics", () => {
  it("ranks by how many distinct questions a topic covers", () => {
    const topics = buildTopics(CORPUS, { minCount: 2 });
    const byslug = Object.fromEntries(topics.map((t) => [t.slug, t.count]));
    expect(byslug["x402"]).toBe(3);
    expect(byslug["settlement"]).toBe(2);
    // Descending, so the chips lead with the beats this corpus actually covers.
    expect(topics[0].count).toBeGreaterThanOrEqual(topics[topics.length - 1].count);
  });

  it("labels a topic the way the corpus writes it", () => {
    const topics = buildTopics(
      [
        q("Do agents pay?"),
        q("How do agents settle?"),
        q("Why agent?"),
        q("Compost basics"),
        q("Soil basics"),
        q("Garden basics"),
      ],
      { minCount: 2 },
    );
    expect(topics.find((t) => t.slug === "agent")?.label).toBe("agents");
  });

  it("drops one-off tokens and never invents a facet that returns everything", () => {
    const topics = buildTopics(CORPUS, { minCount: 2 });
    expect(topics.find((t) => t.slug === "compost")).toBeUndefined(); // appears once
    for (const t of topics) expect(t.count).toBeLessThanOrEqual(CORPUS.length * 0.6);
  });

  it("honours the facet cap", () => {
    expect(buildTopics(CORPUS, { minCount: 1, limit: 3 })).toHaveLength(3);
  });

  it("is deterministic — the same corpus yields the same slugs, so URLs don't drift", () => {
    expect(buildTopics(CORPUS).map((t) => t.slug)).toEqual(buildTopics(CORPUS).map((t) => t.slug));
  });
});

describe("filterByTopic", () => {
  it("returns exactly the entries the facet counted", () => {
    const topics = buildTopics(CORPUS, { minCount: 2 });
    for (const t of topics) expect(filterByTopic(CORPUS, t.slug)).toHaveLength(t.count);
  });

  it("matches a plural slug to its singular questions and back", () => {
    expect(filterByTopic([q("One agent decides")], "agents")).toHaveLength(1);
    expect(filterByTopic([q("Many agents decide")], "agent")).toHaveLength(1);
  });

  it("gives an unknown topic nothing rather than everything", () => {
    expect(filterByTopic(CORPUS, "kubernetes")).toEqual([]);
  });
});
