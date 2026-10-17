# Sponsored research from CLI, stdio MCP and Desktop

These source clients submit ordinary hosted research through the existing
`POST /api/v1/chat/completions` endpoint. Keryx sponsors admitted requests under
the same server-side caller, global, daily, per-query and lifetime limits used
by the web, extension, remote MCP and chat bots. Installing another client does
not create another allowance. No wallet, deposit or account API key is required.

Only submit questions you can share publicly. The sponsored clients require an
explicit public-report choice before sending a question. Local Operator tasks
and references are never automatically copied into a sponsored question.

## Command line

From a source checkout with the documented Node/npm dependencies installed:

```sh
npm run ask:sponsored -- --help
npm run ask:sponsored -- --public "How do source tolls differ from citation rewards?" --mode quick --budget 0.05
```

Help does not submit research. `--public` authorizes submitting the question for
a public trial report. A zero source budget is valid; model and search operating
costs are separate from the source budget. This command does not load the local
engine's `.env.local` or the buyer's custody file. The existing `npm run ask`
engine command and `npm run buyer` retain their separate roles.

## Local stdio MCP

Use `ask_keryx_sponsored` with a shareable question and `publicReport: true`.
The tool supports Quick/Deep research and a zero source budget. It uses hosted
sponsored admission without configuring a signing wallet. The existing
`ask_keryx` tool remains an explicitly caller-funded x402 purchase.

Check the installed server's tool list: an older published package will not gain
a new tool merely because the hosted web service changes. Remote MCP already
provides hosted research and keeps its existing connection and tool contract.

## Windows Desktop

Choose **Sponsored research** to ask a shareable question, select a source
budget and depth, and confirm the public-report notice before pressing Ask.
The result screen shows the returned answer and public report address. Use
**Local tasks** for the private Operator workspace and its existing deliberate
buyer CLI handoff. Sponsored results do not become private local task receipts.

The native renderer retains its restrictive network policy. A trusted native
command passes only the submitted sponsored form to the packaged helper; the
helper uses the shared hosted client. No local task, reference file or wallet
is read to make that request.

## Limits, interruption and evidence

Quota refusals and service pauses are visible. The clients never switch to a
paid tool or resubmit a POST automatically. After a timeout or lost stream,
server work and payments may continue. Keep any original query ID/report URL
that was returned, inspect that original and avoid submitting the question again
as a recovery attempt.

Answers, citations and public evidence come from the hosted producer. A completed
answer does not establish that every source purchase or creator reward settled.
Inspect the original report and payment receipts for settlement evidence. The
clients do not expose or retain private account-claim tickets returned by the
hosted API.

## Delivery boundary

This document describes the source candidate. Required aggregate and applicable
Desktop/platform CI and independent review precede merge. The existing release
owner allocates new MCP/Desktop identities, publishes their exact-source assets
and updates installation links in one release batch. Existing published packages,
download links and owner installations remain independently verified delivery
states; no live sponsored trial or new funding is implied by local tests.
