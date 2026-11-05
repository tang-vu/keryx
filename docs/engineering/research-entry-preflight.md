# Open Research without eager paid preflight

The initial `/research` render used to await hosted treasury/capacity readiness
and Monthly admission before returning its ordinary chat. Those observations can
read retained custody/policy records, query the native writer and contact Arc
RPC/Gateway. They are unnecessary until the visitor reviews a paid request.

An anonymous read-only loopback probe of installed source
`c327dbb8b20793a589a7a937261867f0436d0875` on November 5 observed `/research`
responses of 15.05 and 19.39 seconds. Static `/pricing` controls took 9–30 ms.
Other serving traffic may contribute to those samples; they do not establish
how much of that latency this source change will remove. The probe contains no
authentication, spending, deployment or production configuration changes.

## Request ordering

Opening the page now renders the chat, configured paid-request preparation and
an explicit Monthly price-review entry without initializing payment storage or
performing a readiness observation. Availability stays unknown until the
visitor's actual request is checked. The existing single-request preparation
continues to obtain a validated unsigned quote before exposing checkout.

The Monthly entry performs no request on mount. On an explicit click it uses
the existing pinned, bounded `fetchMonthlyQuote` transport and
`GET /api/research/monthly?quote=1`. Only a successful, schema-validated current
quote loads the existing Monthly wallet/plan component. Failures expose no
funding/signing UI and permit an explicit retry. Duplicate clicks share the
pending operation; unmount aborts it and refuses late results.

This is presentation scheduling. Submission authority remains unchanged:

- `/api/agent/ask` checks current hosted readiness before its paid challenge.
- Monthly quote GET and purchase POST retain `monthlyAdmissionQuote`, including
  native writer, custody, cap and current capacity checks.
- Monthly POST still compares the exact accepted quote and admits its original
  payment authorization before settlement.
- Redemption still checks current execution capacity for a new request. Existing
  authenticated status, replay and original recovery paths are unchanged.

No quote cache, permissive readiness result, signer, nonce, funding or settlement
path is introduced. The displayed quote grants no execution authority. This
follows the October 18 decision separating observation from research admission
in [DECISIONS.md](../../DECISIONS.md).

## Validation and surfaces

The server-render regression refuses any DB, hosted readiness or Monthly
admission call while checking that preparation remains visible. Hermetic
Chromium tests use the real offer, pinned transport, bounded JSON reader and
Monthly quote validator; only the final wallet/plan leaf is an exposure probe.
They exercise no eager request, one explicit GET, duplicate clicks, unavailable
service, malformed JSON, wrong network/economics/schema, retry and late responses
after unmount. Existing paid-request browser and Monthly admission/recovery
tests remain applicable.

Only the web entry changes. API, CLI, remote/stdio MCP, desktop, extension and bot
payment protocols, original recovery and custody authority remain unchanged.
Application/operational types, full PR CI and production browser/build acceptance
remain required. No release version, deployment or publication is included.

Source-qualified measurements, reviews and check receipts are retained under
canonical `.local/release-evidence/research-entry-lazy-preflight-20261105/`.
