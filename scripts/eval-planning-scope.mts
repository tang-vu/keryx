/** Model-only planning diagnostic; inspect targets against the written expectations. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { OpenAICompatibleEngine } from '../lib/llm/openai-compatible-engine';

const args = process.argv.slice(2);
assert(args.every(arg => ['--check', '--live'].includes(arg)) && !(args.includes('--check') && args.includes('--live')), 'Use --check or --live');
const cases = [
  { id: 'pilot-recovery', question: 'How does the Keryx buyer journal a job before submission, and how can it recover after losing the response without paying again? Use the Keryx Engineering source for the documented behavior.', expected: 'Journaling before submission and recovery without paying again; preserve Engineering scope, no extra documentation-summary target.' },
  { id: 'single-fact', question: 'According to the Engineering documentation, when does Keryx save its buyer journal? Answer in a short paragraph with citations.', expected: 'One timing question scoped to the documentation; no targets for formatting or citations.' },
  { id: 'source-reliability', question: 'How does Keryx recover a paid job, and how reliable is the Engineering documentation as evidence for that behavior?', expected: 'Preserve both recovery and explicitly requested source reliability.' },
  { id: 'source-comparison', question: 'Where do the Engineering documentation and the buyer CLI code disagree about retrying payment after a lost response?', expected: 'Preserve the requested disagreement/comparison; do not assume either source is correct.' },
  { id: 'unrelated-topic', question: 'How do mangroves tolerate salt and reduce coastal erosion? Use peer-reviewed sources and answer in Vietnamese.', expected: 'Salt tolerance and coastal erosion with peer-reviewed source constraint; no Keryx or language target.' },
  { id: 'vietnamese', question: 'Keryx ghi journal trước khi gửi job như thế nào và khôi phục khi mất phản hồi mà không trả tiền lần nữa ra sao? Dùng tài liệu Keryx Engineering và trả lời ngắn gọn.', expected: 'Preserve journaling and recovery with Engineering scope; no extra documentation or brevity target.' },
];
assert.equal(new Set(cases.map(entry => entry.id)).size, cases.length);
assert(cases.every(entry => entry.question.length > 0 && entry.expected.length > 0));
if (!args.includes('--live')) {
  console.log(`${cases.length} planning fixtures valid; no model calls. --live runs three rounds (18 requests), requiring manual semantic review.`);
  process.exit(0);
}
const engine = new OpenAICompatibleEngine();
mkdirSync('.artifacts/evals', { recursive: true });
const artifact = `.artifacts/evals/planning-scope-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const results: unknown[] = [];
try {
  for (let round = 1; round <= 3; round++) {
    for (const entry of cases) {
      const targets = await engine.decompose(entry.question);
      results.push({ ...entry, round, targets });
      writeFileSync(artifact, JSON.stringify({ scope: 'Model-only planning, no fallback, purchase, settlement or automatic semantic pass claim.', model: engine.name, results }, null, 2));
      console.log(JSON.stringify({ id: entry.id, round, targets }));
    }
  }
  console.log(`Saved ${artifact}; review all targets against expectations before claiming improvement.`);
} catch {
  console.error(`Planning diagnostic failed; completed rows, if any, are in ${artifact}`);
  process.exitCode = 1;
}
