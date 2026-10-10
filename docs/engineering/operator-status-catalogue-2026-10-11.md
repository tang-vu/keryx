# English Operator, status, proof and economics catalogue

This area 5 increment of [issue #272](https://github.com/tang-vu/keryx/issues/272)
extracts existing web presentation from `/operator`, `/status`, `/proof` and
`/economics`, including the business snapshot, calculator, proof dashboard and
monitoring, registry, dispatch, settlement and reconciliation sections. It is
based on the exact [PR #378](https://github.com/tang-vu/keryx/pull/378)
candidate 84833434369d989dc167812bd17ca2de99c66cca. That prerequisite was
squash-merged to fa4b96cb5aa59fcce8ce6c23f57cbe5553fa8d0d; integration must
preserve its account catalogue and source. The existing
Operator job-ledger and retained testnet-history catalogues are unchanged.

The dedicated [operations.ts](../../locales/en/operations.ts) English module
contributes 351 semantic keys through one import and spread in the existing typed
catalogue. Each migrated component explicitly selects English. Headings,
metadata, row labels, accessibility labels, state explanations, calculator
notices and observation cautions retain the existing wording. Whole sentences
use named data or React-node placeholders; explicit spacer nodes remain named
where required to preserve the original React text boundaries. Counted findings
and notices have `.one`/`.other` forms. Their existing one-item predicates remain;
some English arms deliberately keep identical `partial`, `circuit skips`,
`unverified`, `reservations released` or `unknown inputs` wording. A future
translation can choose distinct grammar without editing the counted sentence.

The nine closed Operator decision explanations match the existing shared
contract exactly. The UI uses a presentation-key map; the authoritative reason
codes and shared explanation contract remain unchanged. Unknown observations
remain unknown. Empty-ledger, unsupported original-network, pending, failed,
unverified and simulated distinctions are preserved. This change alters no
observation validation, request, credential, polling interval, cleanup callback,
spend, settlement or recovery decision. Dates and compact duration units keep
their existing formatting; locale/date presentation remains separate work.

Addresses, network IDs, provider and recorded check labels, recorded alarm
messages, ledger values, server verdict codes and data examples remain data.
The guard retires only 195 owned allowances. The numbered proof-layer prefix,
repository identifier, exact curl example and its `0x…` placeholder retain their existing allowances;
all unrelated entries and original provenance/parser metadata are unchanged.
The new scoped guard regression prevents inline copy returning to these twelve
UI files. The existing study copy and artifact remain unchanged. A separate
issue #249 candidate adds a usage-provenance notice to `/proof`; integration must
retain that independently owned notice and its catalogue.

Bounded local qualification compares 74 exact base/candidate renders or local
calculator action results. It uses the actual twelve components/pages, typed and
rich catalogue helpers, decision contract, calculator arithmetic and network
display with synthetic React hooks and adjacent header/footer/cashout/history
and Link boundaries. Cases cover loading/failure, all worker states and decision
reasons, unknown/zero/recorded counts, 0/1/2 plural arms, retained network cautions,
all reconciliation states, modeled calculator inputs and local import/reset
notices. HTML, React text separators, attributes, controls and action state are
equal. Three metadata exports match and all three public polling callback
bodies are byte-identical. Fixture observations, settlement figures and demand
inputs are explicitly synthetic; no transport, provider, database construction,
signature, payment or live metric verification occurs.

After retaining the repository identifier as data, 69 cases are reused with
exact source/key bindings and five dashboard cases are freshly compared. The
first dashboard-only harness failed its output read-back against the previous
proof filename; that failure is retained. Its corrected invocation passes with
a separate output and complete raw capture.

Focused area/catalogue/format tests, copy-guard regressions and scan, application
and operations TypeScript, and scoped lint provide source acceptance. The
initial render fixture refused the unlisted real recorded-USDC formatter; that
failure is retained, and the correction imports the actual pure formatter.
This is not production CSS/pixel, normal-boot, installer or default Next build
acceptance. Actual exact-source hosted default production build and applicable
CI/review remain release gates. Existing valid evidence for unchanged account
copy and other surface roles can be reused with their precise input bindings.

The new catalogue graph is web presentation, including the existing browser
ask-error helper's catalogue import. API, desktop, CLI, remote and stdio MCP,
extensions and bots keep their existing protocols and observation roles; none
imports the new area module as a separate client contract. No client version,
runtime release identity, root lockfile, study artifact, deployment or locale
activation is changed by this checkpoint. Root owns coordinated release and
integration. Full issue #272 remains open for other copy areas and required human
approval of payment, signature-consent and legal translation semantics.
