import { describe, expect, it } from "vitest";
import { selectEvidencePassages } from "./evidence-context";
import { buildQuoteOptions } from "./quote-options";

// Bounded adjacent paragraphs from the retained 2026-10-04 public captures.
// These fixtures test context availability, never semantic support or model selection.
const wal = "WAL works best with smaller transactions. WAL does not work well for very large transactions. For transactions larger than about 100 megabytes, traditional rollback journal modes will likely be faster. For transactions in excess of a gigabyte, WAL mode may fail with an I/O or disk-full error. It is recommended that one of the rollback journal modes be used for transactions larger than a few dozen megabytes. Beginning with version 3.11.0 (2016-02-15), WAL mode works as efficiently with large transactions as does rollback mode.";
const sqs = "In both standard and FIFO (First-In-First-Out) queues, the visibility timeout helps prevent multiple consumers from processing the same message simultaneously. However, due to the at-least-once delivery model of Amazon SQS, there's no absolute guarantee that a message won't be delivered more than once during the visibility timeout period.";

describe("bounded adjacent source context", () => {
  it.each([
    { name: "SQLite WAL", paragraph: wal, topic: "very large transactions traditional rollback journal", qualifier: "Beginning with version 3.11.0" },
    { name: "SQS visibility", paragraph: sqs, topic: "standard FIFO visibility timeout multiple consumers", qualifier: "there's no absolute guarantee" },
  ])("keeps the complete nearby qualification for $name and exposes it in the bounded quote menu", ({ paragraph, topic, qualifier }) => {
    const competing = Array.from({ length: 7 }, (_, i) => `Dimension${i} is discussed in a separate note. ` + "Unrelated elaboration. ".repeat(8));
    const text = "Introduction. ".repeat(40) + "\n" + paragraph + "\n" + competing.join("\n");
    const result = selectEvidencePassages(text, topic, [topic, ...competing.map((_, i) => `Dimension${i}`)]);
    expect(result.passages.some(p => p.text.includes(paragraph))).toBe(true);
    expect(buildQuoteOptions([{ marker: "S1", passages: result.passages }]).some(q => q.text.includes(qualifier))).toBe(true);
    for (const p of result.passages) expect(p.text).toBe(text.slice(p.start, p.end));
    expect(result.passages.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(2000);
  });

  it("marks omitted neighboring text when a source block cannot fit whole", () => {
    const text = "An oversized opening block. ".repeat(150) + "\n" + sqs;
    const result = selectEvidencePassages(text, "visibility timeout standard FIFO", ["visibility timeout standard FIFO"]);
    expect(result.passages.some(p => p.text.includes(sqs))).toBe(true);
    expect(result.contextOmissions).toContainEqual(expect.objectContaining({ start: 0, blockSuffixOmitted: true }));
    expect(result.passages.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(2000);
    for (const p of result.passages) expect(p.text).toBe(text.slice(p.start, p.end));
    const options = buildQuoteOptions([{ marker: "S1", passages: result.passages }]);
    expect(options.every(q => q.text.length <= 240 && text.includes(q.text))).toBe(true);
  });

  it("keeps oversized unpunctuated source text bounded and makes missing continuation explicit", () => {
    const text = "z".repeat(220_000);
    const result = selectEvidencePassages(text, "", []);
    expect(result.scannedCharacters).toBe(200_000);
    expect(result.passages[0].text.length).toBeLessThanOrEqual(600);
    expect(result.contextOmissions).toContainEqual(expect.objectContaining({ blockSuffixOmitted: true }));
  });

  it("marks the original block continuation when the scan cap cuts a selected tail mid-word", () => {
    const prefix = "Background note.\n".repeat(11_000).padEnd(199_850, "z") + "\n";
    const text = prefix + "The transaction guidance recommends rollback journaling for large workloads. ".repeat(10) +
      "A later qualification changes that recommendation for this version.";
    const result = selectEvidencePassages(text, "transaction guidance rollback journaling large workloads", ["transaction guidance rollback journaling large workloads"]);
    expect(result.passages.some(p => p.end === 200_000)).toBe(true);
    expect(result.contextOmissions).toContainEqual(expect.objectContaining({ end: 200_000, blockSuffixOmitted: true }));
    for (const p of result.passages) expect(p.text).toBe(text.slice(p.start, p.end));
  });

  it.each(["Hi\n", "Hi. "])("bounds dense-format retrieval and still retains eight distinct late targets after %j", padding => {
    const facts = Array.from({ length: 8 }, (_, i) => `Dimension${i} has an explicitly qualified result.`);
    const text = padding.repeat(Math.floor(180_000 / padding.length)) + facts.map(fact => "\n" + fact + "\n" + padding.repeat(100)).join("");
    const result = selectEvidencePassages(text, "Hi research dimensions", facts.map((_, i) => `Hi Dimension${i}`));
    expect(result.scannedCharacters).toBe(text.length);
    for (const fact of facts) expect(result.passages.some(p => p.text.includes(fact))).toBe(true);
    expect(result.candidateSelection!.nominated).toBeLessThanOrEqual(5000);
    expect(result.candidateSelection!.retained).toBeLessThanOrEqual(145);
    expect(result.candidateSelection!.sampled).toBe(true);
    expect(result.passages.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(2000);
  });

  it("reports candidate retention limits separately from source scan limits", () => {
    const text = Array.from({ length: 1000 }, (_, i) => `Hi record ${i} has a distinct documented note.\n`).join("");
    const result = selectEvidencePassages(text, "Hi", ["Hi"]);
    expect(result.scannedCharacters).toBe(text.length);
    expect(result.candidateSelection).toMatchObject({ sampled: true, retentionLimited: true });
    expect(result.candidateSelection!.retained).toBeLessThanOrEqual(33);
  });

  it("does not let varied common-term matches evict every rare late target from bounded retention", () => {
    const facts = Array.from({ length: 8 }, (_, i) => `Dimension${i} has an explicitly qualified result.`);
    const prefix = Array.from({ length: 10_000 }, (_, i) => `Hi overview${i}.\n`).join("").padEnd(180_000, " ");
    const text = prefix + facts.map(fact => "\n" + fact + "\n").join("");
    const result = selectEvidencePassages(text, "Hi research dimensions", facts.map((_, i) => `Hi Dimension${i}`));
    for (const fact of facts) expect(result.passages.some(p => p.text.includes(fact))).toBe(true);
    expect(result.candidateSelection!.retained).toBeLessThanOrEqual(145);
    expect(result.passages.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(2000);
  });
});
