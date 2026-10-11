# Native Desktop English catalogue

This independent increment of [issue272](https://github.com/tang-vu/keryx/issues/272)
extracts the native Operator renderer's English presentation into
`locales/en/native-desktop.ts`. It uses the existing typed `createMessages("en")`
contract. Relative English-module imports make that shared contract usable by
the native renderer, TypeScript and tests without a second message engine or
new module resolver configuration.

The 127 meaning keys include onboarding, workspace/task controls, network and
spending boundaries, seller-report/offline evidence distinctions, busy states,
accessibility/title/placeholder attributes and local notices/errors. Dates,
counts, diagnostics, paths and export format identities are named parameters in
whole messages. Both count arms preserve the existing English exactly, including
`1 research tasks` and the original unrecognized-folder grammar. No translation,
language preference or payment glossary approval is introduced.

The scoped guard migration removes 118 of the renderer's 119 legacy occurrences
and preserves every unrelated allowance and the baseline's original metadata.
One allowance remains: the executable PowerShell buyer command is invariant
protocol data. Its rail, request path, payee, total cap and original journal must
keep their exact bytes. The amount/currency helper also serves that command.
Questions, answers, source/reference names, opaque status/payment identities and
diagnostics received from the native helper remain data. Existing checked
bibliography export labels already live in their own English module.

## Verification and surface boundary

The hermetic renderer harness uses a fake DesktopAPI. Compare rendered English
HTML, title/placeholder/control attributes, disabled states and exact action
arguments before/after at the existing native widths, then visually inspect the
bundled fonts, workspace, task/result and warning states. The catalogue tests
exercise whole-message count grammar, one-pass private-data interpolation and
the preparation/seller-report/offline settlement boundaries. The copy guard
requires only the documented executable command to remain inline.

Desktop esbuild/Tauri packaging consumes the same renderer and English modules.
Required hosted acceptance includes actual desktop typechecking, Windows build,
portable/installer checks and the independent fresh package consumer. Local
renderer parity does not establish installation or native host acceptance.

The web catalogue gains the native keys; its existing messages and engine logic
are unchanged. Web UI, buyer CLI, API, remote/stdio MCP, extension and bots keep
their current roles and message modules. This change does not alter request or
export formats, purchases, recovery authority, native/helper protocols, network
selection, money/date formatting or layout. Desktop package identity and final
distribution belong to the accepted combined release. The other issue272 areas,
exact combined-source acceptance, publication and delivery remain separate
gates; this increment does not close issue272 or translation issue273.
