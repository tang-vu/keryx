# Extension completion and distribution — October 17, 2026

[PR #550](https://github.com/tang-vu/keryx/pull/550), merged as
`64f4490f478274fe254e0ad1eb78d540690c36b7`, fixes a reproduced ordinary-stream
wait: the parser had received a final summary and `[DONE]` but kept waiting for
the HTTP body to close. It now completes that ordinary response and cancels its
reader. Responses carrying any `keryx_private` packet retain the existing clean
EOF requirement. Required completion markers, split UTF-8/CRLF handling, streamed
errors and validation of trailing data already received remain covered.

Seventeen focused stream/popup tests passed, and PR #550 passed its required CI.
A separate API-only check returned a cited Vietnamese answer in 61,958 ms:
[recorded report](https://keryx.cc/dispatch/d0d93834-f599-42ac-abc0-d0b3a58996ea).
That check exercised the hosted API. The original user's Edge cause and the
installed popup's resolution remain unverified. The browser tool refused access
to extension URLs, so no installed-popup end-to-end result is claimed.

## Distribution state and next action

The manifest advances independently from source version `0.1.4.2` to `0.1.4.3`.
This is preparation for a release; published ZIP identity, Store approval and the
current installed version require their own observations. A lookup of the
dedicated `extension-v0.1.4.2` GitHub release found no release; the older
0.1.4.1 Store-preparation notes remain historical.

The existing `scripts/pack-extension.mts` allowlist already contains all twelve
runtime files, including `research-client.mjs`, and needs no change. After review,
merge and successful full CI on that exact main source, run `npm run pack:extension`
to produce `keryx-extension-v0.1.4.3.zip`. Verify its twelve entries and bytes
against the accepted source, then publish that exact ZIP once on the dedicated
`extension-v0.1.4.3` GitHub release. Store submission/approval and installation
remain separate delivery steps.

This update affects the extension's parser and distribution. Web/API, desktop,
CLI, remote/stdio MCP and bot request, payment and account contracts retain their
existing roles. It needs no app/package version change or server redeploy for the
extension ZIP alone.
