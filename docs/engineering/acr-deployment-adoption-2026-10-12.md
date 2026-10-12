# Public deployment observations learned from ACR

The owner requested learning useful patterns from other Tameion projects and
applying them to Keryx. This increment adapts ACR's separation of deployed
availability, source drift and recorded evidence into a small Keryx operations
command. It does not install an upstream agent or change payment authority.

## Source and observed need

Checked October 12, 2026:

- [ACR source, commit 7838669085971b83edb85ff1618fbbb34b728914](https://github.com/kaustubh76/ACR---Arc-Compute-Rate/tree/7838669085971b83edb85ff1618fbbb34b728914).
- [verify_live.py](https://github.com/kaustubh76/ACR---Arc-Compute-Rate/blob/7838669085971b83edb85ff1618fbbb34b728914/scripts/verify_live.py)
  checks each deployed pillar independently and distinguishes observations from
  payment proof.
- [verify_deploy_drift.py](https://github.com/kaustubh76/ACR---Arc-Compute-Rate/blob/7838669085971b83edb85ff1618fbbb34b728914/scripts/verify_deploy_drift.py)
  compares deployed routes with the checkout. An unreadable host is unavailable,
  not proof of a missing implementation; a release gate cannot accept it.
- The pinned repository's LICENSE is MIT, copyright 2026 Kaustubh Agrawal. This
  is a native implementation of the pattern; no upstream code or dependency was
  copied. The complete upstream checker and its chain/wallet integrations are
  not adopted.

Keryx baseline: `b60095280d60f2fe1991b4ae37f14ae8e0a8d5c3`. Existing
`scripts/preflight.mts` inspects local configuration and chain balances. The
redeploy driver checks the deployed health commit. Neither gives an anonymous
observer one bounded command that also checks the public metrics counting
boundary, selected-network usage window and public page reachability.

During the earlier comparison, health was readable and reported `c49f4b3e`,
while a public usage read returned HTTP 403. These are separate dated
observations: the latter does not establish missing source code, and health
does not establish public feature availability or paid research acceptance.

## Command and acceptance

```powershell
$expected = git rev-parse origin/main
npm.cmd run verify:live -- --expect-commit $expected --json
```

On other shells use `npm run`. To observe an isolated development server:

```text
npm run verify:live -- --origin http://127.0.0.1:3939 --network arcTestnet --expect-commit <full-git-sha>
```

The command requires a full lowercase expected Git SHA. Health currently
reports a shortened commit; matching it proves only that reported prefix, not
an independent full-source attestation. A missing or mismatched commit fails.
Mainnet requires the existing `arc` / `real` profile. Explicit testnet can
report offline mode; neither case demonstrates a payment.

The observer makes anonymous GETs to health, metrics, a usage query explicitly
selecting the intended network, and `/`, `/status`, `/proof`. At most two reads
run concurrently. Each observation has a deadline, redirects are refused, and
JSON bodies are limited to 256 KiB. The command reads no environment files,
wallets or local databases and does not return external response bodies,
exception messages or headers. HTTPS is required except on literal loopback.

An unavailable, incomplete, malformed, stale or cross-network usage projection
fails. Aggregate metrics must retain their explicit mixed-origin/all-time,
unpartitioned-network boundary; they are never reinterpreted as outside
traction. Empty, complete cohorts are valid and do not imply demand.

Missing, stale, future or malformed monitoring produces an explicit warning.
`--require-monitoring` makes it a failure. A recent recorded timestamp is not
proof of a passing watchdog, active schedule or current settlement parity.

Exit codes: 0 means the declared observations passed (inspect warnings), 1
means at least one observation failed, and 2 means invalid command arguments.
There are no retries or background schedules. Timeouts report unknown
availability; they are never classified as source drift. Endpoint reads are
not an atomic snapshot. This command does not replace browser interactions,
contract authenticity, receipts, paid acceptance, audits or publication gates.

## Surface and release boundaries

| Surface | Effect |
| --- | --- |
| Repository operations CLI / CI | New `verify:live` command and synthetic failure-path regression gate. |
| Web / API | Existing public GET contracts are observed; runtime source is unchanged. HTML reachability does not establish rendering or interactions. |
| Remote and stdio MCP / buyer CLI | Existing hosted/caller-funded roles remain. Public observation does not invoke MCP tools or prove package readiness. |
| Desktop / extension / bots | Existing API consumer roles and distribution identities remain. No installer/package claim follows from the observer. |
| Payments / database / contracts / scheduling | No state, authority, schema, funding or activation changes. |

This is release-verification maintenance. It does not change application or
distributed-client runtime inputs, require a version bump, or authorize
deployment, funding, schedules or an announcement. Existing user-visible
runtime outcomes retain their own release gates.

## Validation

`node --test scripts/public-deployment-probe.test.mjs` exercises successful
zero-usage observations, commit/profile mismatch, degraded and stale health,
incomplete/cross-network usage, cohort duplication, aggregate-boundary loss,
monitoring strict/warning behavior, redirected/login/invalid/oversized
responses, transport deadlines, safe CLI parsing and a real loopback CLI
failure. Every fixture request is GET-only and anonymous. CI runs the same
regression suite without public network calls or private credentials.

Live observations and required hosted acceptance are recorded separately from
these synthetic checks. No paid workflow or independent usefulness is proved.

At `2026-10-12T09:01:08.377Z`, the native observer queried `https://keryx.cc`
with expected main `b60095280d60f2fe1991b4ae37f14ae8e0a8d5c3`. All six public
reads returned HTTP 503 and the command exited 1. This records unavailable
public observations at that time, not a known cause, source drift, payment
failure or deployment verification. Raw public report retained locally;
availability must be read again after the existing release/operations work.
