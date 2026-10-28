# Load the existing SIWE serializer on sign-in

The shared header imports `useSiweAuth`. Its static `SiweMessage` import therefore
made SIWE and its Ethers dependency reachable during ordinary page startup, even
when only restoring an existing session. An anonymous installed93 homepage sample
contained 34 script tags totalling 892,017 gzip bytes; its largest script contained
Ethers code. That is a transfer observation, not a browser timing or exact module
attribution for the entire page.

The hook now dynamically imports an owned ESM module when a connected injected
wallet starts sign-in. The module retains the original SIWE constructor, validation,
statement, version and message preparation. No new serializer or dependency is
introduced. Loading happens before requesting the finite-lived server challenge.
Session restoration, logout and server-proven Google login do not load this module.

An isolated serializer bundle experiment measured 216,012 gzip bytes with the
original static import versus 707 eager bytes with an owned dynamic wrapper. The
remaining serializer bytes move to the on-demand chunk; they are still needed for
injected-wallet sign-in. These wrapper measurements are not a measured reduction
of the whole Next application, first paint, sign-in latency or production TTFB.

Directly destructuring a dynamic import of the CommonJS SIWE package failed in the
ESM experiment. The owned ESM wrapper keeps the already working static constructor
import inside the deferred boundary. Four origin variants, including IPv6 loopback,
retained identical signed bytes. Replacing the formatter with another library was
unnecessary for this optimization.

## Authentication and failure boundaries

Each sign-in captures a wallet revision as well as the existing logout epoch.
Address, connector and connection changes invalidate it, including a switch away
and back. The hook checks that intent after loading and at the existing asynchronous
challenge/signature/verification boundaries. Logout or unmount while loading cannot
start a new challenge or wallet signature. A failed load for an expired intent is
silent; a current failure asks the user to refresh and retry. No automatic retry or
wallet prompt is added.

`/api/auth/nonce`, `/api/auth/verify`, challenge consumption, server host/origin and
chain checks, signature verification, role lookup and durable session issuance are
unchanged. The browser still sends the original prepared message and signature.
Loading the module grants no session, signing, spending or custody authority.

## Focused acceptance

The 32 focused cases include original-message parity across sixteen combinations
of origins, chain IDs and addresses; original malformed-input refusals; and a real
offline EOA signature verified by the unchanged SIWE library, with wrong domain,
nonce and expiry refused. Real React hook tests cover delayed loading, load failure,
logout, unmount and wallet changes. The existing browser auth/history script also
passes its two-hook logout, stale session, revocation, pagination and mobile checks.

A Chromium fixture bundles the actual hook, React and serializer as separate ESM
chunks. Only the wallet connector, Circle identity and HTTP are synthetic. Its
eager dependency graph contains neither SIWE nor Ethers. Six browser scenarios
exercise successful deferred loading, HTTP503 load failure and refresh recovery,
wallet switch, logout, unmount and Google bypass. Failed or stale attempts obtain
no nonce and perform no signing. All HTTP is intercepted; no funded operation or
vendor access occurs. New files are lint-clean; the original hook's two existing
informational warnings are unchanged. Required hosted typecheck, production build,
browser and applicable authentication/platform acceptance remain merge gates.

## Surface and delivery scope

This affects web wallet login and clients opening the shared web UI. Native desktop,
CLI, API, remote/stdio MCP, extension and bot protocols keep their existing roles.
Server and standalone-client SIWE imports remain available. Existing ROOT/Circle
owns version allocation, publication and one qualified batched runtime release.
Installed93 is unchanged; production page measurements still need to be collected
after delivery.

References: [Next library lazy loading](https://nextjs.org/docs/app/guides/lazy-loading#loading-external-libraries),
[ESM code splitting](https://esbuild.github.io/api/#splitting),
[EIP-4361](https://eips.ethereum.org/EIPS/eip-4361).
