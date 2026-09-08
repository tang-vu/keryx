# English walkthrough rehearsal, September 9, 2026

A captioned walkthrough was recorded from production `95ef47b` / v0.22.12 using
the existing September 8 owner-operated Engineering pilot. It is a rehearsal artifact,
not an uploaded event submission or a recording of a new purchase.

- Local artifact: `.artifacts/rehearsal/keryx-ethonline-english-walkthrough.mp4`
- Duration: 114.96 seconds; size: 3,897,691 bytes; video: H.264, 1440 x 1000.
- Audio: none. English captions are recording overlays, not shipped application UI.
- SHA-256: `e40d6c2544917caf5d06b7e548f943edf8457e5aba12129785cacc5498d32837`
- Scope: price, English request preparation, existing-job lookup, accounting,
  unchanged low-confidence answer, source decisions, evidence and continuity work.

The private job ID was masked before it was entered. No receipt payload or job URL
was opened in the recording. Recording instrumentation observed zero payment POSTs
and zero page errors. Full video decoding completed without errors; sampled frames
were visually inspected for readable captions and masked job identity.

The walkthrough shows the actual 0.05-USDC testnet package, 0.017 settled creator
spend, zero pending creator spend and 0.013 unused reserve. It preserves the original
66.7% grounded rate and low-confidence answer rather than substituting a later
model-only result. These are first-party testnet figures, not external adoption.
See [the paid pilot evidence](./pilot-2026-09-08.md) for payment authority limits.

## Remaining rehearsal work

### Follow-up: CLI output included

The CLI was run again with the original request and private journal, without loading
a signing key. Unsigned `quote` returned `paid: false`, total 50,000 micro-USDC,
creator cap 30,000 and service fee 20,000. GET-only `resume` completed and verified
request binding, receipt integrity and the complete two-payment ledger. The digest
remained `sha256:c07503a70c7fe18d42d7650ec2a671a6beed1931c90baa8b3ee3fdfc72158ccb`.

A follow-up video inserts these actual outputs between request preparation and
existing-job lookup:

- Local artifact: `.artifacts/rehearsal/keryx-ethonline-english-demo-with-cli.mp4`
- Duration: 177.12 seconds; size: 5,286,318 bytes; H.264, 1440 x 1000, no audio.
- SHA-256: `72cdf252ac5ff256a80523481f3664fd11bdd9e79e2eee8a18a6779cf5ba0af9`
- CLI scenes are explicitly labelled presentations of selected captured stdout,
  not live terminal recordings. Private identifiers and acknowledgement details are
  omitted, command paths shortened, and the result is not offered as the full receipt.
- The displayed verification is the real CLI result; its settlement authority remains
  Keryx's ledger, not independently verified chain finality.
- Full decoding passed; no black segment of at least 0.5 seconds was detected.
  CLI frames were visually checked for readable output and privacy labels.

The original shorter video remains available. Neither artifact records a new signature
or purchase, and neither has been uploaded or submitted to ETHGlobal.

### Still outstanding

- The follow-up includes captured quote/resume output, but not a live terminal session
  or purchase/signature scene. Browser lookup alone does not prove CLI recovery.
- Add narration if wanted for the final submission; this artifact is caption-only.
- The recorded source-decision card repeats the article title because the saved source
  name already includes it. Production fix `69558cd` was subsequently verified against
  the original pilot through GET-only browser lookup: the title appears once. Existing
  video files preserve the older UI; this was never evidence of a duplicate purchase.
- Publication and event submission have not been performed. The local binary is
  intentionally outside Git; the repository records its provenance and checksum.
