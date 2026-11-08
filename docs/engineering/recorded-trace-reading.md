# Reading opaque recorded trace entries

The persisted-run contract admits JSON trace entries without reclassifying the
original history. Public report projection keeps those entries in their original
positions. A neutral null or scalar entry cannot make the report unavailable or
erase a valid read checkpoint elsewhere in the trace.

The reading summary and budget meter continue to count only their existing
validated source-read and payment records. The original answer, money, receipt
construction, confidence calculation and stored trace remain unchanged. Private
fulfillment and source-learning sidecars are removed by the existing public
projection. Private, duplicate, future and incorrectly phased checkpoint packets
remain unavailable and are stripped before publication of the raw report.

The reasoning console keeps one row per recorded entry. Unsupported phases use
the existing localized unavailable label and a neutral marker. Original readable
messages remain visible; message objects are never coerced or rendered as React
children. A timestamp is not coerced to create a row key. Valid decision and
selection-diagnostic details retain their existing parsers and presentation.

Regression checks exercise persisted JSON, the actual public GET handler, full
report server rendering, thirteen existing UI locales, payment classification,
portable receipt equality and checkpoint disclosure. The existing production UI
lane also runs the minified report browser fixture with generated production CSS
at mobile and desktop widths. No new copy catalogue, network request, retry,
source purchase, funding, signing or settlement authority follows from displaying
an unavailable trace row.
