# Extension parity — October 10, 2026

The owner requested updating the extension against current web/app/MCP capabilities
and durable coordinated-update notes. The application checkout was detached at historical
`b67b0653` with extension0.1.1; preserve that checkout and its local operational data.
Implementation starts from current source `09c62445` in a focused worktree.

Read-only public audit at 13:39–13:42 UTC found the following distinct identities:

| Surface | Observation |
| --- | --- |
| GitHub latest | [v0.27.47](https://github.com/tang-vu/keryx/releases/tag/v0.27.47), source `e7d0fd3e51eaf4f20070278da029e9dcebdf7dd3`; includes MCP0.4.14 and desktop0.4.13 archives, no extension ZIP. |
| Released extension | [0.1.2 ZIP at v0.27.45](https://github.com/tang-vu/keryx/releases/download/v0.27.45/keryx-extension-v0.1.2.zip), SHA256 `533f9ebd4910e321c4343f7dda6d8cede45e6a7ea134d951cff99926e244a647`; all eleven entries match the initial current-source extension, including canonical formatter. |
| npm / official Registry | Both latest0.4.12. Exact npm0.4.13/0.4.14 and Registry0.4.14 were404. A GitHub tarball is not npm publication. |
| Hosted web/API | Public health200, `c1b23e23`, Arc mainnet, real-mode configuration. Monitoring incomplete/stale; no payment or useful research exercised. |
| Remote MCP | Read-only initialize200/server0.3.9; source0.3.10. Ten tools; source-only delegated `operator_obligations_read` absent. Standalone GET405. |
| Readiness/workspaces | Availability200/not-paused; home, Sources, Literature, drafts, My research and profile shell GETs200. Shell delivery does not prove auth/data writes. Walkthrough connection closed twice; acceptance stays open. |
| Desktop installed | Release manifest identifies0.4.13/e7d0fd3; actual installed version was not established. |

## Candidate outcome

Extension0.1.3 exposes existing Quick/Deep, zero source budget, explicit page-URL/scholarly
consent, original citation links, recorded reference exports, recent completed report links
and editable hosted workspace handoffs. It fixes HTTP/stream failure and truncation being
reported as done, and prevents concurrent keyboard resubmission. Stop/timeout describes
disconnection honestly and retains the original report link when received.

No payment, source selection, payout, auth, database, account, schedule or native protocol
is changed. Full text page access and local keys are not added. Shared request/result roles
remain in web/API/CLI, remote/stdio MCP, desktop and bots; richer evidence/account/Operator
work uses the documented hosted/native handoff. See [current capability table](../browser-extension.md).

Acceptance includes focused actual-popup and SSE failure tests, canonical formatter and
source packaging checks, TypeScript/lint, real Chromium layout/fixture checks, independent
source review, full required CI and exact-source release ZIP verification. Source-ready,
published, deployed, installed and live usefulness remain separate; update the final
readback after completion. This task grants no paid live test or new production activation.

Local verification passed: 35 focused tests across extension client/popup, monetary surface
parity and OpenAI compatibility; application and operations TypeScript; focused lint; and
the real unpacked MV3 Chromium fixture. The browser fixture verifies opt-in page URL wiring,
zero/Deep/scholarly controls, four byte-identical exports without a second request, safe
citation text, failure state, bounded device history/clear and 400/440px horizontal layout.
It intercepts all external transport and performs no useful live research or settlement.
The full CI browser-source lane now runs this fixture; the checks lane packages the
allowlisted extension and retains an artifact identified by the exact CI commit.
