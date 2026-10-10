# Browser extension and coordinated updates

Owner-confirmed October 10, 2026: compare the extension with the actual current web,
desktop, API, CLI, remote/stdio MCP and bot capabilities, implement the applicable
parts, and leave durable notes so subsequent updates consider these surfaces together.
Version numbers alone do not establish feature parity, publication or installation.

Extension **0.1.3 candidate** remains a Chromium Manifest V3 hosted research client.
It uses the existing OpenAI-compatible endpoint and permissions; it has no signer,
account token, local Operator task engine, funding action or scheduler.

| Capability | Extension behavior and authority |
| --- | --- |
| Quick/Deep and source budget | Sends the existing `mode` and `budget` fields; preserves zero and accepts the editable web's $0–$0.08 range. The server still clamps/admit requests; source spending is separate from model/search cost. |
| Current tab/selection | Selection prefills an editable question. The shown HTTP(S) page URL is included only on opt-in, as an ordinary literal URL in that question. No full-page collection or new source-admission contract. |
| Scholarly discovery | Explicit unchecked `scholarly` option uses the existing provider disclosure and hosted discovery rules. Metadata/source discovery is not proof of reading, rights or settlement. |
| Research status and failure | Reads public pause observation. HTTP errors, structured/legacy streamed errors and truncated streams fail visibly. One active POST, no retries. Stop/timeout disconnect observation; server work and payments may continue. |
| Answer, citations and money | Safe text answer, original HTTP(S) article links, exact canonical USDC display, planned rewards/recorded totals/pending spend. The complete hosted report owns evidence review and per-payment receipts. No distinct-settled-creator count inferred. |
| Recorded exports | Download the returned BibTeX/RIS/CSL-JSON/evidence CSV bytes. No new model call, reference enrichment or recomputation. Answer rendering remains plain text; rich Markdown/evidence editing stays on web. |
| Reopening reports | At most ten completed same-origin public dispatch URLs (UUID or deterministic A2A ID) plus timestamps in device storage, with a clear control. No prompts, answers, page contents, tokens or keys saved to this list. It is best-effort device history, not hosted account history. |
| Hosted workspaces and follow-up | Deliberate editable `q`, `budget`, `mode` web draft, omitting `run=1`; Sources, Literature and My research links. Hosted account auth, private drafts, bibliography editing and creator administration keep their existing controls. The scholarly option is chosen again on web because the current editable-link contract does not carry it. |
| Desktop/CLI/MCP/bots | Keep local receipt/export, caller-funded buyer/recovery, delegated read and hosted answer roles. Extension parity does not transplant their keys, filesystem access or account authority into the popup. |

## Required future update workflow

1. Fetch current source and read current supported-surface documentation. Compare changed
   request/result/error, evidence/receipt, money, export and handoff fields with extension,
   web, desktop, CLI, API, both MCP transports and bots. Record intentional handoffs and gaps.
2. Update affected adapters, browser-safe shared helpers, tests, documentation and packaging
   in the same coherent outcome. If extension bytes change, advance its independent manifest
   version and the packer's explicit allowlist. A version bump never substitutes for adapter work.
3. Test actual popup requests, failure/truncation/abort and duplicate submission, zero budget,
   safe links/text, source consent and exact exports; verify real browser layout and the ZIP.
   Keep synthetic acceptance distinct from installed-user usefulness and live settlement.
4. Require the current CI aggregate/review and applicable release gates. Record source,
   deployed, published and installed versions separately for each surface. Verify the released
   extension ZIP against its source and publish it once; Chrome Web Store is a separate gate.
5. Update this capability table and the dated surface-parity/release note. Preserve unresolved
   deployment/npm/Registry/installer/store gates; do not silently treat old observations as current.

The [October 10 scope and evidence](engineering/extension-parity-2026-10-10.md) records
the audit baseline, changes and remaining gates. Installation uses the released ZIP's
extracted directory with Load unpacked; reload an already installed copy only after
its actual source path and version are verified.
