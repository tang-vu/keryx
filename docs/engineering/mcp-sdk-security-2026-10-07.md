# Hosted MCP SDK dependency repair — October 7, 2026

The merged source-inspection release `fedcd8b` passed its PR checks, then its
exact-main CI run [37500148559](https://github.com/tang-vu/keryx/actions/runs/37500148559)
failed the unchanged high-severity production audit. The current advisory feed
reports GHSA-6qxp-vccf-f47h against the root MCP SDK 1.30.0. Earlier zero-high
audit observations remain dated; they do not override this result.

The [maintainer advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h)
identifies an OAuth-client credential disclosure when an untrusted MCP server
selects an authorization server. SDK 1.31.0 is the fixed 1.x release. The advisory
excludes MCP servers and stdio clients from this path; upgrading alone also does
not repair old issuer-less credentials or unbound custom/bundled OAuth providers.

Keryx's production SDK imports are the hosted MCP server/HTTP transport and the
caller-funded stdio server. Test clients use in-memory or stdio transports.
No production SDK OAuth client/provider or stored OAuth credentials were found
in the scoped import/call-site inspection. This is not evidence of a credential
incident, nor a reason to waive the dependency gate.

## Change and validation

Pin the root SDK to **1.31.0**, matching the already-pinned caller-funded package.
The exact pin keeps this repair on the maintainer's fixed version already used
by the stdio package.
Root app metadata advances to **0.27.10**. Regenerate the root lock with the pinned
npm 11.19.0 installer and verify that no unrelated dependency closure changes.
Do not run a broad audit fix, alter the audit threshold or introduce OAuth clients.

Release checks: fresh installation, the existing real-SDK stateless HTTP and
in-memory MCP fixtures, request-body/origin/admission checks and research adapter
compatibility; TypeScript, lint, offline production build and current production
audit. Independent diff review and exact-head CI precede merge. Actual current-main
CI/source acceptance, reviewed deployment and commit/network health remain separate
gates. Record observed results in the local release evidence; this document alone
does not certify that checks, deployment or usefulness have passed.

## Supported surfaces and operational boundary

| Surface | Effect |
| --- | --- |
| Hosted remote MCP 0.3.2 | Root installation now uses SDK 1.31.0. Server/transport compatibility is checked; existing protocol tools, admission, body limits, receipts and sponsored authority remain unchanged. |
| Web, API/SSE, A2A and bots | Receive the root dependency closure; no client OAuth flow, payment implementation, research contract or provider allowance changes. |
| Caller-funded stdio MCP 0.4.6 | Already pins SDK 1.31.0; package metadata/lock and implementation remain unchanged. No new npm version or installed-client upgrade is inferred. |
| Desktop 0.4.7, extension 0.1.1 and CLI | Existing source/role boundaries remain; no new feature, signer or installer-version capability is claimed. Any source-bound CI publication keeps its own exact-source identity. |

Source-inspection functionality remains in main. The UI comparison from 603 to
fedcd8b stays historical and cannot attest this dependency successor. Existing
protected source acceptances, wrappers, storage manifests, held roles/schedules and
the failed original remain bound to their recorded sources. The independent
offhost recovery, capacity and fulfillment-schema migration gates still apply.
No deployment, new spend, key/custody change or model/search request is authorized
by this patch or a green audit. Announce the hosted update only after deployment.
