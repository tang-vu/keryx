# English common shell and observation wrappers

This [issue #272](https://github.com/tang-vu/keryx/issues/272) increment depends on
the exact [PR #379](https://github.com/tang-vu/keryx/pull/379) candidate
446b99f743d66b04a3d04fce2bf9ae80cffc2b59. It extracts four previously adjacent
boundaries: `SiteHeader`, `SiteFooter`, `CreatorCashoutsPanel` and the server
`HistoricalHistorySection` in `testnet-history-summary.tsx`.

The dedicated [shell.ts](../../locales/en/shell.ts) contributes 51 semantic keys
to the existing typed English catalogue. Navigation, accessible menu controls,
external-link labels, footer prose, cash-out explanations/tooltips and the
unavailable-history action keep their exact English. Whole rich sentences use
named nodes and data; explicit spacer nodes preserve existing React text
boundaries. The fixed copyright year is named data, with no clock behavior
change. These four files introduce no counted sentence requiring plural arms.

The guard retires only 78 owned allowances: 62 detected copy occurrences and
16 stale allowances in the history wrapper. Four examples remain data: `MCP`,
the `Keryx` mark, the quoted Greek source word `κῆρυξ`, and the `/tx/` path.
Other baseline entries and provenance/parser metadata are unchanged. A scoped
regression prevents English returning to these four files outside their
catalogue. No allowance or source is refreshed merely to silence a failure.

The navigation route selection, menu toggle/escape/outside-click callbacks,
wallet/dispatch boundaries, contract/profile selection, original-network links,
money/date formatting and archive-reader call order remain unchanged. The
history action is still a manual link, without automatic retries. This changes
no authentication, wallet, settlement, archive/storage or API behavior. Existing
cash-out claims are preserved as wording; fixture rows do not establish a real
payment or live traction. Human review of financial/signature/legal translation
semantics remains required before any locale activation.

Bounded local qualification compares 38 exact base/candidate component renders
and action results: open/closed navigation and toggles, both footer profiles,
empty/compact/full cash-outs with original/unknown rails, and six archive
success/failure branches. It uses actual brand glyphs, card/table, historical
display and pure format/network/catalogue helpers. Only React hooks/pathname,
Next Link, unchanged wallet/dispatch boundaries and the archive reader are
controlled fixtures. Four callback bodies, CSS class attributes and server/client
directives are identical. No archive/database implementation is imported or
opened. An initial unpinned-mainnet footer refusal is retained; the corrected
offline render uses a fictional matching public registry pin, never deployment
authority. Valid 74-case area 5 evidence is reused only for unchanged source and
message/helper inputs; these 38 cases qualify the newly migrated boundaries.

Application/operations TypeScript, 35 catalogue/format tests, 22 guard regressions,
the actual copy scan and scoped lint provide source acceptance. They do not
establish CSS/pixel, normal-boot, deployed or default Next build acceptance.
Root owns current-main integration, coordinated release identity and actual
exact-source hosted build/CI. This checkpoint changes no release metadata,
dependency closure, study artifact, shared protocol or client distribution.
The pure module serves web presentation, including its server-rendered history
wrapper and the existing browser catalogue consumer. Desktop, CLI, API, remote
and stdio MCP, extensions and bots retain their current independent roles.

## Bounded completion map

The post-migration guard observes 2,568 syntactic candidates in 156 of 220 tracked
JSX files. Findings include intentionally retained data/protocol examples;
these are ownership hints, not counts of untranslated copy or completed work.
The full local map pins each candidate file and examples. Path-based groups are:

| Suggested area | Files with findings | Detected occurrences | Next concrete source boundary |
| --- | ---: | ---: | --- |
| Ask/research | 22 | 452 | Funding readiness, private checkout, evidence browser, monthly-plan controls |
| Reports/retained answers | 11 | 142 | Dashboard loading/empty states, dispatch/topic metadata, evidence exports |
| Sources/creators | 39 | 808 | Source discovery, registration, creator listing controls, personal sources |
| Account/session-associated | 4 | 40 | `app/me/asks/page.tsx` and `my-asks-view.tsx` contain 37 candidates; remaining three are vendor marks |
| Operator/status/proof/economics | 3 | 4 | Declared numeric/repository/protocol examples in the area 5 checkpoint |
| Landing/common shell | 13 | 115 | MCP integration, playground errors, literature entry, remaining common children |
| Legal | 2 | 94 | Authoritative English privacy/terms pages; translation review gate remains |
| Other shared UI | 61 | 794 | Classify literature workspace, citation evidence, freshness and public-source claims before ownership |
| Independent desktop boundary | 1 | 119 | Existing desktop renderer role; no client migration or version change here |

The guard cannot resolve imported labels, arbitrary helper returns, closed-enum
label maps or non-JSX clients. For example, the unchanged
`components/keryx/phase-style.ts` trace labels still require an area 1 source audit.
Runtime API errors and CLI/MCP/extension/bot prose need their owning contract and
adapter review; syntactic JSX counts cannot certify their extraction.

| Original acceptance criterion | Current evidence and remaining gate |
| --- | --- |
| No visible English literals outside catalogues in all listed areas | Open. This increment covers four named files; the source boundaries above remain. |
| Rendered English unchanged, with existing tests and visual pass | Bounded migrated renders/handlers and prior unchanged evidence pass. Complete-area visual/release acceptance remains open. |
| Guard against new literals runs in CI | The existing guard remains wired in CI; this adds the four-file regression. |
| Accessibility labels, titles, alt text and toast copy included | Menu labels and transaction titles are extracted here; remaining area candidates require migration and review. |

Full issue #272 remains open. Catalogue extraction does not enable a locale,
approve a human translation, change data into authority or prove synchronized
production delivery. Integration must preserve independently owned additions,
including issue #249's proof-page usage notice.
