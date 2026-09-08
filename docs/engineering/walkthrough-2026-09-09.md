# English walkthrough rehearsal, September 9, 2026

The latest artifact is the **157.4-second narrated follow-up** below. The two older
caption-only recordings remain historical artifacts of the partial-quality pilot.

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

## Narrated follow-up: supported pilot on the current UI

Recorded production UI `5e86b91` / v0.22.13 while reopening the existing September 9
pilot. The paid job itself ran on `69558cd`; this recording does not rerun it or prove
the later passage-selection change end to end. Its preserved result has two targets
at coverage 0.8/0.9, CACHE/SKIP decisions, 0.015 USDC citation spend, zero pending,
and 0.015 unused reserve under the 0.05-USDC fixed-price package. Unused reserve is
not an automatic refund. It is owner-operated, first-party Arc-testnet evidence.

- Local artifact: `.artifacts/rehearsal/pilot7/keryx-ethonline-english-narrated-demo.mp4`
- Duration: 157.4 seconds (2:37.4); size: 6,902,594 bytes.
- Video: H.264, 1440 x 1000, 25 fps; audio: AAC.
- SHA-256: `fefaffae7f7e2887df278e1c2c35911725b850a85f3209dfffaa5a0f8ff72c32`.
- English narration is synthetic: Microsoft David Desktop, en-US, rate 1.
  [Spoken script and timing](../ethonline-narration.md). Captions are recording overlays.

Unsigned CLI `quote` and GET-only `resume` were executed again without loading a
signing key. Quote remained unpaid at 50,000 micro-USDC. Resume verified integrity,
request binding and the complete one-payment ledger, preserving digest
`sha256:d7a907246ae509d2678cc39f6915d6603b0a0459a4899eb7963685bb748fb723`.
The CLI scenes are labelled selected captured stdout, not a live terminal capture,
new signature, full receipt or independent settlement check. Private job identifiers
and acknowledgement details are omitted from that display projection.

The browser job ID was masked before entry. Recording instrumentation observed zero
payment POSTs and zero page errors. Final video decoding passed; H.264/AAC streams
were present and no black segment of at least 0.5 seconds was detected. Sampled price,
CLI, masked lookup, cache-decision and evidence frames were visually inspected.
Narration clips fit their scene intervals; measured maximum audio level was -1.2 dB.
Original videos and receipts are preserved. Uploading the reviewed video and submitting the event form remain
owner actions; neither has occurred.
