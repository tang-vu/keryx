# Private browser reload investigation

Observed against production `b9d114e` on September 10, 2026. These are owner-operated
read-only diagnostics on Arc testnet, not an independent wallet or paid-checkout pilot.
No purchase, quote, funding or payment submission was allowed by the browser probes.

## Controlled observations

Each completed series contains one initial navigation and two reloads. Readiness means
the expected signed-out control, import control, or saved local recovery button became
visible. It is not a general page-load benchmark. The first journal navigation includes
importing the existing private recovery file into an ephemeral browser profile.

| Browser/state | Initial readiness | First reload | Second reload |
| --- | ---: | ---: | ---: |
| Headless shell, signed out | 4458 ms | 794 ms | 1524 ms |
| Headless shell, signed in without local journal | 5008 ms | 1501 ms | 2244 ms |
| Headless shell, imported journal, browser trace enabled | 7693 ms | 9109 ms | 8859 ms |
| Full Chromium headless, imported journal | 4842 ms | 1372 ms | 1681 ms |

All recorded navigation responses in these completed series were HTTP 200 without
the Cloudflare challenge header. The authenticated completed series confirmed temporary
session sign-out. A separate recent-probe session cleanup check found no matching live
short-lived sessions to revoke and confirmed sign-out of its own temporary session.

A separate headless-shell run stalled during the initial import/readiness sequence,
after four successful session lookups. Its renderer and GPU processes continued using
CPU while renderer profiling did not respond. The temporary browser tree was explicitly
closed; that run is not a pass. This extends the earlier reload-only symptom and does
not establish a JavaScript loop, a database defect or a Cloudflare challenge as its cause.

## Trace and implementation evidence

One successful headless-shell series produced a 20-second browser trace with 172056
events. The captured window included about 9345 ms of background JavaScript parsing
across 63 tasks and 9113 ms of background parse waiting. These are inclusive durations
across tasks/threads, not additive wall-clock delays. The largest captured FunctionCall
was 87 ms; captured layout events totaled about 427 ms. This trace contains no proven
stalled interval and cannot explain the earlier hangs. Raw traces and private fixtures
remain local; no questions, signatures, cookies or private job IDs are published here.

The installed WalletConnect connector's `setup()` calls `getProvider()`, which dynamically
imports and initializes the provider. Keryx registers that connector when configured in
`lib/wagmi-config.ts`, and `app/providers.tsx` mounts wallet state across the application.
This is a concrete initial-load performance investigation target. It is not proof that
WalletConnect caused the stalls. Any deferred initialization must preserve existing
connections, reconnect behavior, event listeners and explicit wallet selection.

Playwright documents that its default headless shell and the full Chromium headless
channel are different browser implementations; `channel: "chromium"` selects the latter.
See [Playwright browser documentation](https://playwright.dev/docs/browsers). The small
comparison above does not prove the issue is exclusive to headless shell or resolved
for ordinary users. Instrumentation, caching and timing also differ between runs.

## Remaining acceptance

Keep browser reliability and independent extension/mobile wallet acceptance open. Use
the full-browser channel as an additional live diagnostic, while retaining the existing
headless-shell CI coverage. Capture an actual stalled interval before attributing its
cause or changing application payment/recovery logic. Independently measure wallet SDK
startup and reconnection before redesigning their initialization. The previous successful
deletion/re-import check remains a single observed journey, not a general stability claim.

## Subsequent startup change: v0.22.48

The remote-connector wrapper now defers new-visitor provider initialization while
preserving remembered connectors and explicit selection (D-161). Eight focused tests
use actual wagmi connection actions with synthetic providers, including restoration of
a non-current saved connector, capability forwarding, account/disconnect events and
setup failure/retry. Provider authorization remains required even with stored hints.

Local production-browser checks observed no external request before selection in their
observation window. Selecting MetaMask or WalletConnect started additional SDK chunk
loads; both vendor QR/connection interfaces were visually verified in full Chromium.
These checks did not pair a real wallet, sign a message or send a payment. They validate
SDK startup and presentation, not mobile pairing, independent wallet behavior, an end-to-end
latency improvement or a fix for the earlier stalls.

A subsequent live read-only owner check on commit `f551131` (September 10, 15:02 UTC)
passed import, result recovery, desktop/mobile layout, reload, local deletion and
re-import recovery. It made six private reads and zero payment requests, observed
zero page errors, rejected a foreign session with 404 and confirmed logout. This
remains one owner-operated journey; it does not establish independent wallet acceptance.
