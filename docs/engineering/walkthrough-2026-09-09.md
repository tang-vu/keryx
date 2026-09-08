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

- This video explains the independent buyer CLI but does not record its quote,
  signature or terminal receipt verification. Those scenes remain in the broader
  [demo plan](../ethonline-demo.md); browser lookup alone does not prove CLI recovery.
- Add narration if wanted for the final submission; this artifact is caption-only.
- The source-decision card repeats the article title because the saved source name
  already includes it. This is a presentation issue observed during recording, not
  evidence that the source was bought twice.
- Publication and event submission have not been performed. The local binary is
  intentionally outside Git; the repository records its provenance and checksum.
