# Preserve bounded homepage comparison plans

The owner supplied the SQLite homepage failure beginning “A valid plan with at
most 8 independent research targets could not be prepared.” The historical
provider response is unavailable. Controlled transport reproduces that exact
refusal for a complete four-target comparison when JSON span values omit their
boundary spaces, or repeat an existing scope span in `constraints`. This proves
a planning-protocol defect, not the historical provider's particular output.

The parser now restores only boundary whitespace from the original question,
matching every remaining caller span exactly and in order. Missing words,
punctuation, changed internal whitespace, foreign scope and split URL tokens
still refuse. A repeated constraint is accepted only when its exact trimmed
value is already a scope span retained in every constructed target. Mixed
opaque claims and genuinely oversized comparisons remain terminal refusals;
there is no repair call or umbrella fallback. The prompt now distinguishes the
noncomparison claims/constraints shape from the comparison shape. Evidence,
quote review, rewards, provider limits, payment authority and stored reports
retain their existing behavior.

Local acceptance uses offline testnet configuration, isolated injected stores
and deterministic transports. The unchanged new answer regression failed twice
before the runtime fix with the reported planning message; its nine-target
refusal passed. After the fix, all 117 tests in `research-plan.test.ts`,
`json-chat-engine.test.ts` and `homepage-plan.test.ts` passed (exit 0, full EOF).
The answer regression traverses the real OpenAI-compatible engine, orchestrator,
two controlled original reads, separate evidence review and final cited answer;
all four requested subject/dimension pairs survive, with zero payments. These
fixtures establish no live-provider semantic accuracy or successful production
SQLite/YouTube answer. No billable model, search or payment call was made.

| Surface | Applicable behavior and distribution boundary |
| --- | --- |
| Browser and HTTP API | `/api/ask` uses the shared planner. Existing SSE/refusal/result contracts remain compatible. |
| Hosted remote MCP, OpenAI-compatible API and agent-to-agent API | Server research uses the same planner; adapter and payment contracts are unchanged. |
| Local CLI | `scripts/ask.mts` imports the shared local agent and receives the fix when run from the updated checkout. |
| Stdio MCP | Its buyer and sponsored tools hand research to hosted endpoints; they do not embed this reasoning engine. No stdio package identity or publication is claimed here. |
| Native desktop | Sponsored research uses the hosted client through its helper; planner modules are outside the helper/renderer entry paths. No installer publication is claimed. |
| Browser extension | Its existing hosted research handoff receives server behavior; extension code and artifacts are unchanged. |
| Telegram and Discord | Their server routes invoke shared research; bot adapters and command contracts are unchanged. |

The existing browser composer permits a new explicit request after an error,
and the failed turn remains visible. It clears on submit and restores requests
only for maintenance, paused research and rate limiting; generic planning errors
have no one-click exact-question retry. Readers can copy/edit the visible
question and submit a fresh request under current admission and budget checks.
This change does not rewrite a saved failure or retry it automatically. A retry
convenience UI remains separate work. Required CI, merge and the coordinated
production release remain with ROOT; no synchronized package or deployed-source
claim follows from these local checks.
