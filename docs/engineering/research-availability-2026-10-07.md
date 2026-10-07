# Ordinary research availability — October 7, 2026

Issue [202](https://github.com/tang-vu/keryx/issues/202) records an owner-operated
production reproduction: MCP discovery succeeded while ordinary research was
held, and submitting a question exposed an internal operational instruction.
That observation did not establish useful research or independent business use.

Application **0.27.14 candidate** adds a filesystem-only, no-store public
observation at `GET /api/research/availability`, using the existing fail-closed
canary admission observer. `not-paused` means absence of that global hold;
request-specific authentication, allowances, caps and payment checks still apply.
This observation grants no authority and initializes no database or quota.

Web composers, including the embedded widget, show availability before a new
question. Known pauses disable submission while leaving the question editable
and saved reports accessible. A rejection that races with the observation uses
fixed public copy and restores an emptied composer without removing its failed
turn. Manual availability checks perform no research. A successful recheck can
dismiss the UI rejection latch; another question still requires an explicit
submission and all server controls. Shared `run=1` links wait for the initial
observation and cannot dispatch during a known pause or an unknown observation.
Manual submission when observation is unavailable remains subject to the server.
Known holds appear above the research controls. Other observations appear below
the action so the question, source cap and action still fit small mobile screens.

Remote MCP **0.3.3 candidate** keeps initialize and four-tool discovery available.
The setup page says the endpoint is connected and separately shows research
availability. `keryx_status` adds `researchAvailability`; hosted research rejection
adds public `research_paused` metadata before quota/provider/payment work. The
real-SDK tool handler also checks the hold and returns an error result if paused.
OpenAI HTTP and streamed error metadata, browser HTTP/SSE and hosted bot error
formatters share fixed copy. Typed local admission refusals terminate reasoning
without provider retry, fallback or provider-circuit success/failure mutation.
Internal operation diagnostics remain available to their existing private callers.

| Surface | Role and remaining boundary |
| --- | --- |
| Web conversation and iframe | Read-only availability, retained draft/error, manual recheck |
| Remote MCP and setup | Connectivity separated from admission; version 0.3.3 candidate |
| Ask API/SSE and OpenAI compatibility | Structured public held category; existing controls retained |
| Hosted Telegram, Slack and Discord | Shared safe failure copy; no real messages sent in validation |
| Repository ask CLI | Existing shared error formatter carries safe held copy |
| Paid A2A, desktop and caller-funded stdio MCP | Existing paid-admission/recovery contract remains authoritative; no new payment or original-recovery action |
| Extension | Hosted OpenAI error envelope supplies the readable pause; local payment authority unchanged |

Local fixtures use isolated offline/testnet configuration without Supabase or live
provider credentials. Real browser fixtures cover held shared links, raced
rejections, explicit composer/widget rechecks and connected-but-held MCP setup.
Existing protected canary, ask authentication/session, zero-budget, MCP SDK,
disconnect and provider resilience tests cover adjacent behavior. Exact-head CI,
production build, independent review and supported-client dependency checks are
release gates. The combined 16-file run passed 213 tests (one expected Windows
skip); the final six browser fixtures also passed after the embed race correction.
Application/operations TypeScript, scoped lint and production build passed.
Independent final source review found no blocking findings. A test pass is not
ordinary live research acceptance.

Browser harnesses explicitly intercept the new availability GET without permitting
extra writes. Compiled responsive checks retain first-viewport actions at mobile
320–430px and desktop widths; chat fixtures retain progress, stop, older-report
scroll and follow-up behavior. The status panel's mobile regression was corrected
without relaxing the layout assertions.

Actual four-entry esbuild input graphs contain none of the changed hosted
modules: desktop helper 45 inputs, renderer 1, bridge 1 and stdio MCP 34.
Keep the separate client versions and original publication/installation gates;
the extension already renders the hosted OpenAI `error.message` envelope.

The separate already-paid original operation binds current main `8c6f95d`.
Keep this candidate isolated until its operational owner clears the source and
restoration gate. Supplier-window expiry does not clear that gate or authorize
renewal. Version ordering must be reconciled with other unmerged candidates.
After that gate, merge/deploy under the standing workflow and verify current-main
health and actual hosted MCP version. Package/installer versions and installed
clients require their own evidence. Original delivery/usefulness, new ordinary
client research quality, legitimate creator supply and independent demand remain
open acceptance work.
