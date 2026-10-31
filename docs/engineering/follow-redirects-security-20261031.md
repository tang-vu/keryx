# Cross-realm redirect-header security patch

PR #772's unchanged production dependency audit reported the high-severity
[GHSA-mrwp-f3q8-3g9p](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-mrwp-f3q8-3g9p)
against `follow-redirects` 1.16.1. The
[upstream 1.16.2 release](https://github.com/follow-redirects/follow-redirects/releases/tag/v1.16.2)
recognizes a caller's `sensitiveHeaders` array across JavaScript realms using
`Array.isArray`. Previously such an array could be discarded, allowing a declared
custom credential header to reach a cross-origin redirect destination.

Update only the resolved `follow-redirects` lock record to 1.16.2. It satisfies
the existing Axios `^1.16.0` requirement. The package count, dependency graph,
root declarations, existing overrides and audit threshold stay unchanged. Registry
tarball SHA-512 integrity is verified before isolated local qualification; shared
dependencies and production installations are not modified.

The controlled paying-source study binds the complete lockfile. Reproduce all 48
offline trials against the qualified patched graph, then check the generated
artifact and write-up again. The source closure, closed corpus, protocol, trial
outputs and outcomes remain exact; only the lock fingerprint changes. The
existing outbound denial, zero model/search calls and simulation-only boundary
remain intact. Do not edit the fingerprint directly or waive the drift check.

The existing security-dependency test lane now exercises loopback redirects with
same-realm and cross-realm sensitive-header arrays, object and array-form headers,
custom and built-in credentials, unrelated safe headers and same-origin behavior.
All credentials are synthetic. These checks demonstrate the dependency behavior;
they do not claim an exploit of Keryx. The upstream advisory states that its
direct Axios 1.20.0 test normalized the array and did not reproduce this issue.

Keep the high production audit gate and all applicable current source, build,
domain and platform checks. Remaining moderate/low advisories retain their own
review scope. Exact-head PR acceptance, merge provenance and actual-main
publication checks precede source closure. Runtime delivery remains under the
existing ROOT/Circle release owner; this source patch does not deploy production.

Two hosted standard-user portable launches did not expose the WebView2 CDP
endpoint. Their WMI diagnostic also timed out before the window-handle query, so
the root cause remains unproven. Keep the existing 30-second startup acceptance
and every packaged test. Record the disposable user's actual token integrity and
elevation, observe the owned window independently of WMI, and retain bounded
original startup JSON/stdout/stderr as a separate CI artifact. Do not retain the
browser profile, credentials or dependency/build caches. These are test-harness
diagnostics; application runtime, machine policies and user defaults are unchanged.

The [upstream elevated-host report](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645)
is a diagnostic lead. The observed non-administrator fixture has not established
that cause; actual token and process evidence must decide the next correction.
