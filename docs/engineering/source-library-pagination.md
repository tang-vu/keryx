# Sources directory pagination

`/sources` filters and sorts its complete directory before selecting a page for
each collection. `paperPage` selects eight bibliography cards; `explorePage`,
`citedPage`, `feedPage` and `creatorPage` each select twelve cards. The first page
is the default. Page values use the first repeated parameter, accept positive
decimal integers of at most seven digits, and clamp to the last available page.
Malformed values return the first page; empty collections stay empty.

The server renders only those cards. It no longer places every remaining card in
a closed directory `<details>` element. Each collection has bounded numeric GET
links, the current page is marked with `aria-current`, and links target that
collection's heading. Links retain parsed directory filters, article search and
cursor, and other collections' clamped positions. Existing directory filter
forms and topic links start fresh collection pages. Pagination links disable
Next prefetch, so hovering or showing them does not request another directory
render. All pages remain accessible without JavaScript.

Counts, source ordering, structured data and every card's original metadata,
reading-scope labels, publisher-control notices and financial displays retain
their existing inputs. A page number grants no source, payment or privacy
authority. Article archive pagination remains separate. There is no `all` or
visitor-selected page-size escape.

This bounds card generation, HTML and client-component payload for off-page
cards. It does not reduce the directory's database reads, full-history decoding,
claim checks or retained-reference materialization. Feed previews and paper
versions within an on-page card still use their existing bounded details. Local
synthetic markup measurements describe that fixture only; production latency and
transfer size require a later authorized deployment and measurement.
