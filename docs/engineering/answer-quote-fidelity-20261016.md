# Grounded quote rendering — October 16, 2026

Verified clean base `ef8341954328a947fda1346ee39f3548fa1dbc55` on
`fix/answer-quote-fidelity-20261016`. Metadata PR431 was already merged October 13
as `285498cb`, an ancestor of this base and current main. This is a separate fix.

`finalizeGroundedAnswer` places U+200B after literal inline delimiters. The reader
ignored that convention and consumed the stars in `If-Match: *` and
`If-None-Match: *` as italic markup. The renderer now requires unescaped opening
and closing delimiters for bold, italic and code, and permits escaped delimiters
as their content. Only captured markup is formatted; unmatched text cannot become
markup merely because it starts and ends with delimiter characters. Original
offsets, sentinel bytes, quote language spans and real citation controls remain.
Grounding, stored answer/quote text and payment/reward guards are unchanged.

The affected consumers are web answer cards, saved dispatch reports and embedded
reports. Extensions that open hosted reports receive the same reader correction.
Native desktop plain-text results, CLI, API, remote/stdio MCP and bot payloads
retain their existing answer bytes and separate renderers; no adapter, contract,
package or installer change is needed for this component fix. No deployment or
published-version synchronization is claimed here; Root owns delivery.

Validation:

- Before the renderer change, all 14 new DOM render cases failed. They cover
  finalized source quotes, literal citation-like text, escaped opening/closing
  delimiters, normal formatting, quoted language and actual citation clicks.
- After the change, **67 tests passed** across the new render tests,
  `lib/agent/answer-grounding.test.ts` and
  `lib/i18n/report-language-metadata.test.ts`.
- Focused ESLint passed for both component files; `git diff --check` passed.
- Independently compared all 1,858 nonroot package-lock entries with
  `website-get-started-20261012`: no differences. Used its node_modules through
  a local junction for read-only dependency access, with caches disabled and the
  Vite cache path isolated locally. No install, rebuild, provider or payment ran.

The existing Vitest config does not include `components/**/*.test.tsx`. This
focused invocation explicitly collects the new file without modifying config:

```powershell
@'
import path from 'node:path';
import { startVitest } from 'vitest/node';
const files = ['components/keryx/answer-markdown.test.tsx', 'lib/agent/answer-grounding.test.ts', 'lib/i18n/report-language-metadata.test.ts'];
const ctx = await startVitest('test', files, {
  config: false, run: true, watch: false, include: files,
  maxWorkers: 1, cache: false, testTimeout: 20000, hookTimeout: 20000,
  env: { KERYX_EXTERNAL_DISCOVERY: '0' },
}, { resolve: { alias: { '@': process.cwd() } },
  cacheDir: path.resolve('.artifacts/answer-quote-fidelity-vite') });
if (ctx.state.getFiles().some(file => file.result?.state === 'fail') || ctx.state.getUnhandledErrors().length) process.exitCode = 1;
await ctx.close();
'@ | node --input-type=module
node node_modules/eslint/bin/eslint.js components/keryx/answer-markdown.tsx components/keryx/answer-markdown.test.tsx
```

Root retains whole-source TypeScript/build, independent review, required CI,
new-test discovery integration, merge and batched release. This worker commits
only the three assigned files locally; it does not mutate coordination records.
