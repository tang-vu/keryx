/** Independent ownedHistory namespace; English baseline only, no translation activation. */
export const ownedHistoryCopy = {
  title: "Your owned research history", checking: "Checking your account…", signedOut: "Sign in to read your history.",
  unavailable: "Owned history is unavailable. Privacy, ownership or storage capabilities may not be admitted on this deployment.",
  scope: "Current store only. Recorded provenance describes the saved run; unknown metadata stays unknown. Settled receipt amounts exclude simulated and pending payments. Missing receipts do not prove zero spend.",
  walletOnly: "This deployment supports this verified wallet only; stored multiwallet membership is unavailable.",
  claimsMissing: "Anonymous claimed-run history is unavailable on this deployment.",
  search: "Question contains (case sensitive)", surface: "Surface", network: "Recorded receipt network", funding: "Settled funding", visibility: "Visibility",
  from: "From (UTC)", to: "Through (UTC)", all: "All", apply: "Apply filters", empty: "No matching runs in this scan page.",
  scanLimited: "The bounded scan continues. Use Next even when this page is empty.", next: "Next", previous: "Previous", refresh: "Refresh",
  exportJson: "Export history JSON", exportCsv: "Export history CSV", exportScope: "Exports are bounded to 20 pages / 1,000 rows / 2 MiB and carry explicit completion and continuation metadata.",
  report: "Read report", receipts: "Receipts JSON", references: "References BibTeX", own: "Your settled spend", sponsored: "Other payer settled spend",
  unknown: "Unavailable", private: "Private", unlisted: "Unlisted", public: "Public", save: "Save visibility", erase: "Delete research text",
  confirmErase: "Delete this run's research text? Financial records are retained. This cannot be undone.",
  failed: "The operation was refused or unavailable. Refresh before retrying a revision change.",
  memberReadOnly: "Changing a member wallet's run requires that wallet's interactive session; history read does not grant mutation authority.",
  paidCreators: "Cited creators with recorded settled citation receipts", close: "Close report", receiptBound: "Receipt projection truncated; spend totals unavailable.",
} as const;
