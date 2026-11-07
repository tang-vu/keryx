# Demo labels in recovered receipt exports

Older receipts can retain a synthetic-demo label or a complete known seed
fingerprint on a citation or a single evidence record, while sibling excerpts
have neither. The checked application export previously classified each evidence
record independently, so its CSV could call those siblings recorded excerpts.

After the existing receipt and task checks, the export now uses the same marker
propagation policy as `demoteSyntheticEvidence`: an explicit demo label or a
complete known fingerprint marks all evidence with that marker illustrative.
The fingerprint still requires the exact title, URL and body hash. A title and
URL alone cannot classify a source. Other markers retain their recorded status.

The evidence matrix still requires the original matching source, article, URL
and content version and a bounded exact excerpt. Original receipt, result and
buyer-intent bytes, answer text and financial history remain intact. The export
does not authenticate a source's claims or change payment authority. Its output
uses the existing CSV schema and labels.

Regression coverage compares recovered and live exports for citation/evidence
labels and complete fingerprints, checks incomplete-fingerprint and unmarked
controls, and exercises checked recovery, saving and offline reopening through
Operator. The saved-result inspection contract used by the native reader is
unchanged; this correction applies to application research exports. Web/API,
desktop, CLI and remote/stdio MCP share that export policy where applicable.
Extension and bot handoffs retain their existing roles. No provider call,
payment, deployment, publication or version change is required by this source fix.
