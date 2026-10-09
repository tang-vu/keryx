# UI copy regression guard

Issue [272](https://github.com/tang-vu/keryx/issues/272) calls for extracting
English interface copy into catalogues, area by area. This increment implements
the regression guard first. It does not extract the existing interface or enable
a locale. The intentional checked-in [baseline](../locales/ui-copy-baseline.json)
records detected legacy occurrences at its named source commit.

From the repository root, after installing the project's pinned dependencies:

```sh
node --test scripts/check-ui-copy.test.mjs
node scripts/check-ui-copy.mjs
```

The guard uses the lockfile's exact TypeScript parser to inspect tracked JSX/TSX
in `app/`, `components/` and `desktop/src/`. It parses source without loading the
application, JSX runtime, environment files or databases. It refuses malformed
source, unmerged/symbolic Git entries, paths escaping the checkout, invalid
baseline metadata and a parser-version mismatch. New files must be staged or
committed before a local scan; CI always sees the committed source inventory.

## Detected contexts

- JSX text and literal child expressions, including conditional/fallback branches
  and sentence templates with embedded literal branches.
- Accessibility, title, alt, placeholder and other listed presentation attributes.
- Toast titles/descriptions, confirmations, alerts and named UI error/status setters.
- Presentation descriptor labels and direct metadata titles/descriptions/alt text,
  including static Next title objects' `default`, `template` and `absolute` leaves.
- Local constant aliases and object label lookups used by those contexts, with
  simple lexical shadowing and cycle protection.

CSS classes, hrefs, test IDs, condition enum values, catalogue lookup keys,
formatter options and dynamic questions/answers/source titles/creator names are
not treated as literal labels merely because they appear near JSX. Whitespace
and decorative punctuation alone are excluded. Templates containing only data
interpolation add no invented copy. Findings are syntactic candidates: explicit
data examples or technical names can still need a documented exception.

Each allowance binds file, syntax context and exact text with SHA256 and an
occurrence count. Moving lines or deleting copy is allowed. New/changed copy,
copy in a new file/context, or an extra duplicate occurrence fails. Hashes keep
the baseline free of a second full copy of legacy strings. A hash is an allowance
identity, not a human translation approval or security signature.

A reused local declaration is counted once per syntax context. Rendering the same
constant in another context (for example, adding a title attribute to an existing
child expression) requires a separate allowance. Static metadata title objects
are followed through local constant aliases; unrelated data objects with
`default`, `template` or `absolute` fields remain excluded.

The reviewed guard correction adds only the existing `app/layout.tsx` title
template (`%s · Keryx`) to the legacy inventory. Guarded UI source still matches
the baseline's named commit; its other allowances and provenance are retained.

## Adding or migrating copy

Put new interface text in the English catalogue for its product area, using
meaningful keys and named interpolation/plural forms. Pass resolved messages to
components; data stays data. The locale/key/formatter foundation is owned by
[271](https://github.com/tang-vu/keryx/issues/271), not invented by this checker.
Do not bypass the guard by moving English phrases into arbitrary helper calls.
Review payment, consent and legal copy under the
[translation instructions](translation-instructions.md); an agent review or
baseline entry cannot mark it human-approved.

During each area migration, remove its retired allowances in the same PR so old
inline copy cannot be reintroduced under a stale allowance. Preserve the actual
rendered English, accessibility labels, toasts and metadata with appropriate
behavior and visual checks. The parser does not establish visual equivalence.

An intentional baseline exception requires a stated reason and source review;
do not refresh the baseline simply to silence a failure. Commit the relevant
source checkpoint first, then explicitly record that commit:

```sh
node scripts/check-ui-copy.mjs --write-baseline
```

Review the resulting allowance diff with the source change. This command refuses
CI execution and uncommitted changes in guarded source paths. It does not infer
that a reason is legitimate; review remains authoritative. Parser upgrades also
require a reviewed inventory refresh. CI never regenerates the baseline.

## Boundaries and acceptance

This is a bounded syntactic regression check. It does not analyze arbitrary
helper return values, callback/data flow, imported constants, mutable bindings,
all metadata factories or non-JSX source. It cannot prove all visible text is in
catalogues. The complete area migrations and their visual acceptance remain open
under issue272. The baseline is not a migration-completion count.

The main CI step checks this guard independently of the runtime lane selection.
Web and desktop JSX authoring are covered. API, CLI, remote/stdio MCP, extension
HTML/JavaScript and chat-bot prose keep their existing runtime roles; their future
catalogue migrations need suitable separate guards. No runtime component,
contract, package/installer version, locale activation, deployment or product
announcement changes in this tooling increment.
