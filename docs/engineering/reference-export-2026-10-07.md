# Reference export compatibility — October 7, 2026

Application 0.27.15 and desktop 0.4.8 are candidates, first verified on main `8c6f95d2`
and integrated after the merged 0.27.12 to 0.27.14 releases.
This fixes an observed interoperability defect in a core literature-review flow;
it does not establish useful live research or independent business usage.

## Observed defect and correction

The [Zotero RIS translator at c7551c1](https://github.com/zotero/translators/blob/c7551c1a4d5b9623273119c7fbadf8735731dc92/RIS.js)
does not recognize `UNPB`; its fallback imports that record as `journalArticle`.
`MANSCPT` maps to `manuscript`. Keep the explicit preprint label in the provenance
note, exact arXiv version, observed read scope and unknown peer review. Journal
articles still use `JOUR`; ordinary web references use `WEB`. BibTeX stays unchanged.

The translator treats N1 notes as HTML. Encode `&`, `<` and `>` there so recorded
metadata remains literal. Scalar URLs retain their bytes, including query `&`.
For a scholarly record without supplied journal metadata, omit the journal field
instead of inventing one from its source name; keep that source in the note.
This scoped N1 correction does not certify every importer or scalar field as safe.

## Reproducible checks and limits

- Formatter regressions cover types, missing journals, literal notes, versions,
  omitted article links and unchanged BibTeX/URL encoding.
- Real React/Chromium Blob downloads at 320 and 1366 pixels check RIS/BibTeX bytes,
  filenames, exact version, read limits and omission counts. These component
  fixtures do not claim full responsive-page or Zotero application acceptance.
- Hosted A2A/OpenAI/remote MCP and checked-receipt projections produce the same
  exports without mutating their original run. Existing Operator tests cover
  receipt integrity, task binding and refusal to overwrite destinations.
- The styled reading harness checks the actual archived dispatch download too.
- CI downloads the exact upstream translator separately and verifies SHA256
  `1011694cf9459553ae019fe09c4bbb0b27ad57d739f22bd25cba0ca64d624554`
  before running `scripts/test-zotero-ris.mts`. No upstream code is vendored or
  shipped. A minimal VM host executes its real type/record/N1/accession logic;
  an old-tag negative control confirms the silent journal-article fallback.
  Fixtures omit authors/dates/DOI; host field validity is permissive and non-note
  HTML entity decoding is stubbed. Full metadata validation, unsupported-field
  preferences and the Zotero desktop UI remain outside this test.

Local commands after installing the pinned project toolchain and dependencies:

```powershell
node node_modules/vitest/vitest.mjs run lib/research-citation-export.test.ts lib/research-citation-export-browser.test.ts lib/research/surface-result.test.ts lib/research/receipt-exports.test.ts lib/operator/task.test.ts
curl.exe --fail --silent --show-error --max-time 30 https://raw.githubusercontent.com/zotero/translators/c7551c1a4d5b9623273119c7fbadf8735731dc92/RIS.js -o .artifacts/reference-export/zotero-RIS.js
node --import tsx scripts/test-zotero-ris.mts .artifacts/reference-export/zotero-RIS.js
```

Create the ignored artifact directory first. The standard production build and
`node --import tsx scripts/test-reading-evidence.mts` check compiled styles and
archived downloads. Run local app checks with explicit offline/testnet settings
and blank Supabase variables; no provider, payment or shared database is needed.

## Supported surfaces and release gates

| Surface | Behavior and boundary |
| --- | --- |
| Web/chat/embed and public dispatch | Current local downloads use the shared formatter over recorded citations. No enrichment or payment. |
| Hosted API/SSE, A2A, OpenAI, remote MCP | Newly generated shared exports use the correction; their shapes and authority remain unchanged. Existing paid response/export snapshots remain immutable. |
| Repository CLI / Operator | New explicit reference exports rebuild from an integrity-checked, original-task-bound saved receipt. Raw results and receipt bytes remain unchanged. |
| Desktop | Actual helper bundle imports the formatter; candidate 0.4.8 updates npm, Tauri and Rust package identities together. Renderer/bridge do not import it. |
| Caller-funded stdio MCP | Actual 34-input bundle has no formatter input; it forwards the server result and keeps package 0.4.6. It cannot rewrite existing paid snapshots. |
| Extension / bots | Existing page/link and answer roles remain; no new reference-manager integration or public receipt contract. Extension stays 0.1.1. |

Actual local helper/renderer/bridge input counts are 55/11/3 with full metafiles
retained in ignored QA evidence. Only the helper imports the changed formatter.
Native writer/storage semantics remain authoritative; export formatting stays in
TypeScript. Desktop CI must pass source-bound Windows packaging, portable/installed
identity and a fresh-consumer check. Publication readback and an owner-installed
upgrade are separate evidence, never inferred from server deployment.

Remote MCP keeps the 0.3.3 protocol identity merged with the 0.27.14 admission
release; this format-only change does not advance it. The owner chose to merge the
held candidates while production stays on `8c6f95d2` for the original operation; do
not deploy over that gate without its genuine closure/restoration handoff. After
clearance, follow current-main deployment/health, distribution verification and
Canteen product-update steps. No simulated figures may be reported as settled traction.
