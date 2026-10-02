# Invited Arc mainnet pilot candidate

The owner requested preparation on October 2 for an October 3 bounded mainnet
pilot. Expedite by reducing audience and feature scope. No concrete funded budget
or launch authorization has been granted. Full product acceptance, sustained
economics and independent repeat-use evidence remain separate from this pilot.

`npm run preflight:mainnet-pilot -- --candidate <explicit-json-file>` validates a
reviewable proposal. Add `--live` to reuse the existing fixed-endpoint
[public Arc inspector](arc-mainnet-readonly-probe.md). The command never loads
dotenv, keys, wallets, databases or application runtime; it never signs, submits,
deploys, creates a scheduler or authorizes mainnet. Default production payment
configuration remains testnet. `candidateAccepted: true` and exit 0 mean only that
the candidate declarations fit this bounded scope. `mainnetReady`,
`launchAuthorized` and `currentRuntimeSupported` remain false.

Create the manifest in a private local operator location, outside the repository.
The strict schema rejects extra fields, including private keys. It reads exactly
one explicit regular JSON file, at most 16 KiB, checks its opened identity and
size/time stability, and reports fixed errors without paths or file contents.
Nonregular files and symbolic links are refused; the platform's available
no-follow/nonblocking open flags and post-open identity checks also limit races.
No proposed state/environment file is opened. JSON stdout is redacted: it retains
the proposal digest, profile, participant counts, limits and fixed gate codes,
rather than addresses, support owner, filesystem paths or private input.

Required fields:

| Field | Declaration |
| --- | --- |
| `schema` | `keryx-mainnet-pilot-candidate-v1` |
| `releaseCommit` | Exact lowercase 40-character source commit under review |
| `deploymentId` | Explicit lowercase pilot instance name, 3–64 characters |
| `mainnetOrigin`, `testnetOrigin` | Distinct credential-free HTTPS origins |
| `mainnetStateRoot`, `testnetStateRoot` | Absolute disjoint directories, with no `.` or `..` segments |
| `mainnetEnvironmentFile`, `testnetEnvironmentFile` | Distinct absolute paths outside the opposite network's state root |
| `invitedBuyerAddresses` | 1–5 unique nonzero EVM public addresses |
| `creatorPayoutAddresses` | 1–5 unique nonzero EVM payout addresses |
| `retainedTestnetSignerAddresses` | 1–100 known retained signer addresses; none reused as pilot buyer or creator |
| `limits` | Canonical integer strings for `totalMicroUsdc`, `perBuyerMicroUsdc`, `perAskMicroUsdc`, `perPaymentMicroUsdc`; integer `maxAsks` |
| `rpcUrl` | One of the four officially documented fixed public Arc mainnet RPCs used by the inspector |
| `registryAddress` | Proposed mainnet registry address, or `null` while deployment remains open |
| `supportOwner` | Local accountable operator label; no contact messages are sent |

Conservative **proposed** ceilings are total 1 USDC, 0.25 USDC per buyer,
0.05 USDC per ask, 0.01 USDC per payment, and 20 asks. These values are chosen
preparation limits, not user-approved funds or observed costs. Payment ≤ ask ≤
buyer ≤ total is required. Amounts use six-decimal ERC-20 micro-USDC, never Arc's
18-decimal native gas denomination. No aggregate reservation or spend enforcement
is provided by a manifest: the eventual runtime must durably enforce all limits
across requests, processes, restarts and pending exposure before any signing.

Owner-operated buyer/creator role overlap is permitted and explicitly counted as
`selfFundedBuyerCreatorCount`. It never establishes independent creator/customer
traction. Fresh testnet-to-mainnet signer isolation remains required regardless.

The digest binds schema-owned key order, exact release commit, origin/path
declarations, public role inventory, proposed limits, registry and operator.
Changing any of these requires a fresh review. Declaration checks use conservative
case-insensitive lexical path comparison on Windows and Unix. They cannot prove
real filesystem separation, links/mounts/hardlinks, permissions, key inventory,
absence of reused historical wallets or actual deployment commit. Those require
separate observed enrollment/host acceptance. A provided registry address also
does not establish deployed code or creator payout authority.

## Pilot scope across supported surfaces

| Surface | Candidate role and release boundary |
| --- | --- |
| Web browser | Intended invited caller-funded research entry; existing signing/grant/journal domains need explicit migration and funded acceptance before activation |
| Caller CLI | Excluded from mainnet purchases in the first browser pilot; its current protocol/journal/recovery remain testnet until a separate coordinated migration |
| Source/citation API | Eventual pilot creator delivery and bounded rewards must bind exact version, registry payee, integer allocations and original payment evidence; current production endpoints remain testnet |
| Sponsored web, treasury, paid A2A, private A2A | Excluded from mainnet spending in this pilot; no fallback from an absent caller grant to treasury |
| Remote MCP, stdio MCP | Excluded from mainnet purchases; hosted treasury and caller-funded package roles remain separately testnet |
| Desktop/Operator | Local inspection and deliberate handoff only; no mainnet signing, funding, scheduled buying or runtime cutover |
| OpenAI/browser extensions and bots | Existing hosted testnet entry points; excluded from mainnet purchases and no package/installer release claim |
| Autonomous workers and operating scripts | No mainnet spending/scheduler; explicit read-only operator preflight is the only new command |

The next financial release gates are shared runtime-domain migration, identity/
permissions and complete key inventory, mainnet registry/creator authority,
durable global pilot admission, independent review, funded original settlement and
response-loss recovery, creator withdrawal, isolated deployment/restore/monitoring,
and an explicit owner decision on source commit, participants, funds and limits.
The [existing provenance dossier](engineering/arc-mainnet-contract-provenance-2026-10-01.md)
and static SDK/public RPC observations are reusable evidence with their stated
limits. A live public probe does not satisfy the funded gates. Profitability or a
four-week adoption cohort is not an activation prerequisite for this bounded pilot;
neither is claimed by it. See the separate [complete-product M1–M8 map](mainnet-delivery-plan.md).

Validation includes hermetic role/path/budget/release-digest refusal tests and real
subprocess command acceptance, redacted errors, oversize/malformed/nonregular
input refusal and keyless help. Linux CI exercises FIFO/symlink refusal. Live
probe evidence is an explicitly requested separate observation, never synthetic
settlement evidence.
