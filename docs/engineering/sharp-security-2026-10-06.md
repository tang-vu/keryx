# Sharp/librsvg security patch - October 6, 2026

Application **0.27.8 candidate** advances the existing Next-scoped sharp override
from 0.35.4 to 0.35.5. The locked native sharp packages advance to 0.35.5 and their
libvips packages to 1.3.4. No other dependency versions change. Next remains
16.3.6; npm remains pinned to 11.19.0.

The maintainer's [GHSA-wq5f-xc86-pv6w advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)
identifies sharp <0.35.5 as affected by CVE-2026-96889 in librsvg and >=0.35.5 as
patched. It identifies a possible memory-safety/RCE issue on glibc Linux under
specific runtime conditions and recommends prebuilt librsvg 2.63.2.
The [0.35.5 release notes](https://sharp.pixelplumbing.com/changelog/v0.35.5/)
bind the native dependency release to
[sharp-libvips 1.3.4](https://github.com/lovell/sharp-libvips/releases/tag/v1.3.4).
The project already overrode sharp to 0.35.4, so this patch preserves that lane
and the installed Next optional dependency's ^0.35.4 contract. A broad audit fix,
framework upgrade, decoder-disable workaround or weakened audit gate is unnecessary.

## Verification

Local checks used Node **24.12.0**, the actual npm **11.19.0** installer, and a
fresh isolated dependency tree. CI continues to use Node **24.21.0** and npm
11.19.0. The production audit on October 6 returned exit zero for
`npm audit --omit=dev --audit-level=high`: **zero high/critical, seven low and
nineteen moderate findings**. This is a dated dependency result, not a claim that
all vulnerabilities are resolved or an independent product security audit.

`node --test scripts/security-dependencies.test.mjs scripts/sharp-security.test.mjs`
passes six checks. The new fixture checks every locked native platform version
and uses a real child with a 15-second deadline, 8 KiB output limit and 64 MiB JS
heap cap. A JS heap cap is not an OS/native-memory RSS limit. The child observes
sharp 0.35.5 and librsvg 2.63.2, renders a tiny SVG, checks pixels and dimensions,
uses the actual installed Next optimizer for PNG-to-WebP resizing, refuses
malformed XML and an input exceeding the chosen pixel cap, and exercises the
existing desktop brand generator's SVG/PNG/alpha API at all eight sizes in memory.
No env file, image-network fetch, account/key or provider API is used. These are
version/compatibility/resource-boundary regressions, not a reproduction or proof
of every exploit condition in the advisory.

Sixteen focused dependency, security-header, session/Gateway custody and
synthetic backup-encryption checks passed. Main and operational TypeScript
checking passed. Repository lint passed with five existing warnings in unchanged
files. The offline Arc-testnet production build passed, and the installed Next
worker fixture retained its explicit deployment heap limit. The unchanged
required CI includes the new image fixture beside the existing high audit gate.
Exact-head CI and separate review remain acceptance gates before release.

## Supported surfaces

| Surface | Effect and release boundary |
| --- | --- |
| Web image optimizer and hosted API/server | The runtime native image closure is patched; app metadata becomes 0.27.8. Existing image configuration, CSP, default SVG refusal, authentication, public response fields and payment authority remain unchanged. |
| Repository CLI, paid workers, bots and remote MCP 0.3.2 | Root dependency installation receives the patch; these modules have no sharp image-decoder call. Research/receipt/custody contracts, provider budgets, roles and schedules are unchanged. |
| Desktop 0.4.7 | Helper, renderer, bridge, style, static icons, Rust sources and manifests remain unchanged. The build-only brand generator imports root sharp; its existing API pattern passed the in-memory fixture. No installer was rebuilt or published. |
| Caller-funded stdio MCP 0.4.6 | Package metadata/lock and its external dependency lane remain unchanged. The runtime bundle has no sharp/Next image-optimizer input. No package publication is claimed. |
| Extension 0.1.1 | Its allowlisted source, manifest and hosted handoff are unchanged; it does not bundle sharp. No extension publication or store acceptance is claimed. |

A controlled esbuild 0.28.2 comparison against source
`2593023895598585d618731613e47396ea3ee448` produced identical bytes for these
runtime graphs. The helper's source-commit define was fixed to `source-comparison`
and symlink-preserving resolution gave both source trees the same dependency
layout. The semantic lockfile comparison independently confirmed that only the
sharp native closure changed; neither sharp nor Next appeared in these graphs.

| Comparison output | Bytes | SHA-256 (both sources) |
| --- | ---: | --- |
| Desktop helper | 234301 | 0371a2ce84154772d0a79efa6323d0818f33b80bbfaa96c0dcd0bc687a34d2a5 |
| Desktop renderer | 213207 | 7ea509448e8ad3d1f2213364b877153a95cd67e6e58fbc22707affa9e484d638 |
| Desktop bridge | 2421 | f6c57fdc44d6d173825c8399c218aa378cbc1b6f59098d67a8b9004702222dc1 |
| Desktop style | 16896 | 2d28028c1847c24a53d8e11590f10968c059ab6f7539f6a123b23b9a5b9140e5 |
| Stdio MCP | 80193 | 062dadfc46ae07067371e1fcb6617202563ea159a0e46d2c2103dbe00aaeafde |

These comparisons justify retaining the independent client versions for this
patch. Existing source-bound publications retain their original accepted
attestations; comparison outputs are not new installers, Rust-writer artifacts
or publication attestations at the new web source. Deployment, actual published
identity and installed-client acceptance remain separate observations. The
current [mainnet record](../mainnet-status.md) is not relabeled by this candidate.
