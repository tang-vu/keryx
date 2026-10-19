# Manual hosted immutable preparation

[Hosted immutable preparation](../.github/workflows/hosted-immutable-preparation.yml)
runs the existing official preparation command on GitHub-hosted Ubuntu24.04 with
Node24.21.0/npm11.19.0. It provides an alternative to the local WSL builder whose
observed backward wall-clock changes invalidated native authentication fixtures.
It changes no application, authentication, payment or storage guard.

The release owner dispatches it manually on `main` after review and required CI.
Supply the full 40-character current main commit, the existing public Circle app
UUID and Google client ID, and reviewed published mainnet registry write/read
addresses. The source must equal both the checkout and `origin/main` captured by
that checkout. There are no scheduled or push triggers, production credentials,
SSH steps, deployment, package publication or automatic retries.

Dependencies and Chromium/system libraries install before isolation. The one-shot
[driver](../scripts/prepare-hosted-immutable-release.mjs) then runs as the ordinary
runner user in a new loopback-only network namespace, with capabilities dropped
and privilege escalation disabled. Only PATH, fresh control/scratch paths and the
six public configuration values reach the command. GitHub tokens and the runner's
other environment variables are omitted. The driver verifies the actual network
namespace and privilege state before launching preparation.

It invokes exactly once:

```text
npm run redeploy -- --prepare-release REPO RELEASES FULL_COMMIT DEPENDENCIES NPM_CLI --mainnet-public-build
```

The official helper creates a fresh scratch directory. A separate observer waits
for that real directory and independently copies the installed browser cache into
its default HOME location before tests start. Both the original command and the
observer must naturally close with exit0, no signal, complete stdout/stderr EOF
and no capture errors. A failed command retains its actual logs and exit data;
it cannot yield an accepted cohort. The observer does not create the official
scratch, change tests, supply a fake success, send signals or retry preparation.

Typechecking and tests keep arcTestnet/offline1 and fresh keyless storage. Only the
explicit mainnet build uses arc/offline0, preserving the strict mainnet runtime
configuration contract. It receives matching nonzero write/read registry twins
and the validated public connector identifiers. Outbound network remains denied
through compilation and route collection; no runtime ENV file, private key,
funded storage manifest, Supabase or provider credential is loaded.

After actual official success, `cohort-FULL_COMMIT.tar.gz` contains exactly:

- `FULL_COMMIT/source/`, including the complete independently copied dependency
  and Next build cohort;
- the original `source-manifest.json`, `artifact-inspection.json` and
  `preparation.json` under `FULL_COMMIT/`.

GNU tar preserves hidden files, contained links and executable/read-only modes.
Preparation scratch, browser caches and diagnostic logs are outside this archive.
`cohort.json` records the actual archive SHA-256/size, original receipt digests,
artifact digest and build ID. Receipts are not rewritten or re-recorded after
transfer. The existing target inspector verifies their original source/artifact
digests before any separately authorized activation.

The workflow retains this archive, metadata and actual command/check logs as an
Actions artifact for three days. Compression is disabled for the upload because
the cohort is already gzip-compressed. On failure the upload preserves available
diagnostics and partial output; absence of `cohort.json` is not acceptance. There
is no candidate overwrite or release cleanup. Retain the downloaded archive and
its verified hash in the canonical local release-evidence root before expiry.
Downloading is not implemented as a production transfer or deployment step.

Every original receipt and hosted metadata record remains
`productionAdmitted:false`. Existing final-main, compatibility, native financial,
custody, held-state, role, maintenance and postflight requirements still govern
the release owner's single batched deploy.

Focused checks:

```sh
node --test scripts/prepare-immutable-release.test.mjs scripts/prepare-hosted-immutable-release.test.mjs
```

GitHub documents [manual dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
and [artifact retention and permissions](https://github.com/actions/upload-artifact).
The workflow must first exist on the default branch; this PR does not dispatch it.
