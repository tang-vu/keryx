export const literatureSearchCopy = {
  label: "Search saved papers and notes",
  guidance: "Search titles, authors, DOI/arXiv IDs, years, venues, links or saved notes. All words must match. Latin accents are optional. Search stays in this tab.",
  clear: "Clear search",
  scope: "Reference downloads contain only papers shown by both search and screening. CSV and JSON backup contain all saved papers. Notes stay out of reference downloads.",
  empty: "No saved papers match this search and screening filter.",
  outsideSearch: "Outside the current search; still selected.",
  sortLabel: "Sort saved papers",
  sorts: { saved: "Saved order", title: "Title", year: "Recorded publication year — newest first", recent: "Recently saved" },
  sortNotice: "Sorting uses saved metadata, not new source observations. Missing years appear last. Visible reference downloads follow this order; CSV, JSON backup and your comparison selection keep their original order. Sort choices stay in this tab.",
} as const;
