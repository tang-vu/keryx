# CI bootstrap for split Ubuntu security sources

PR776's corrected production job stopped before browser installation because the
Ubuntu24 runner had two URI fields: the existing official mirror-list transport
and a direct `http://security.ubuntu.com/ubuntu` security stanza. The old helper
admitted only mirror-list URI fields. This is a source-setup failure; it does not
establish an application build or browser failure.

[The official runner image setup](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh)
rewrites the Azure archive URI to a local mirror list and does not rewrite a
separate security URI. [APT documents the local mirror-list transport](https://manpages.debian.org/unstable/apt/apt-transport-mirror.1.en.html).
The new branch recognizes exactly one ordinary main stanza and one official
security stanza on Ubuntu24 noble. It requires the original Ubuntu archive
keyring, expected suites/components and ordinary binary-package fields; unknown
hosts, credentials, ports, queries, duplicate fields or trust overrides refuse
before privileged writes.

For this recognized split input, setup changes only the security URI's HTTP
scheme to HTTPS and preserves all other source-file bytes, including line
endings. The existing fixed HTTPS mirror list, timeouts, retries, runner context,
file-type/size limits, install readback and local-execution refusal remain. An
already HTTPS security stanza is accepted without another source-file write.
The original mirror-only input keeps its existing two-write plan.

The focused Node fixture suite exercises both source forms, repeat execution,
malformed/host/suite/keyring/trust drift and installation/readback failures. It
uses injected filesystem/install functions; no local APT, sudo or production
operation is run. Required hosted CI, applicable platform/original workflows and
exact-main publication acceptance still have to pass. Workflow filters, actual
Chromium installation and every application/payment/custody assertion remain.

This shared CI repair is separate from PR776's comparison translations. After
the repair is accepted on main, reconcile that retained UI branch and repeat its
required acceptance on the combined source. No CI result from the failed UI
candidates admits either outcome, and no runtime version/deployment is requested.
