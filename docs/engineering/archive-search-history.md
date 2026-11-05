# Returning to archive search results

The public answer archive stores its client-side filter in the current URL. For
example, `/answers?language=vi&q=SQLite&searchPage=2` restores the query and second
page of matches outside the server-rendered cards. The same component serves
archive page and topic routes.

Typing immediately replaces the current history entry, so a reload cannot race a
pending save. Moving between result pages adds a history
entry, so Back/Forward restores the query and result position. Editing or clearing
a query resets that position; clearing removes both search parameters. Other URL
parameters, fragments and router history metadata are preserved.

The filter still renders the original cards on the server, without requiring a
dynamic route or a JavaScript-only archive. After hydration it reads the URL and
filters locally without fetching. Invalid page parameters start at the first
page, and positions beyond the remaining results clamp to the last page. If the
browser refuses a history write, local filtering remains usable.

`lib/archive-search-history-browser.test.ts` exercises actual reloads, report
navigation, Back/Forward, Unicode queries, rapid edits, clear/reset behavior,
invalid positions and denied history updates. The existing archive browser tests
cover responsive layout, keyboard/focus, reduced motion, localization, stable
server-rendered cards and shrinking result sets.

This changes the web archive only. Desktop, CLI, API, MCP, extension and bot
research contracts, payment authority and publication behavior are unchanged.
Deployment remains a separate owner-authorized release.
