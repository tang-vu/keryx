# Read visible dashboard questions first

The dashboard displayed four recent questions but fetched and refreshed 25 full
public-history summaries while the other 21 were hidden inside a closed
disclosure. It now requests four initially. Opening More questions mounts a
separate bounded 25-row reader; closing it aborts pending work, stops its refresh,
and removes its component state and older bodies. Reopening starts fresh. The
four visible questions keep their existing ten-second privacy refresh.

The expanded reader excludes the current four IDs and rows newer than the oldest
visible question, so independently refreshed snapshots cannot duplicate recent
questions or mislabel newly arrived questions as earlier ones. It shows its own
loading/error/retry state while recent questions stay available.

This is a request-size and demand-loading change only. The classified
`/api/runs` route still classifies and filters its complete bounded window before
paging through `publicUsage.history`, whose privacy list receives the requested
take. Database guards, privacy and evidence projections, financial calculations,
API defaults, public counts, and client deadlines are unchanged. Complete-window
classification still runs. No target verdict or response cache is added.

Public app0.27.78 QA observed the independent 156-question count and four recent
cards working, but financial/account reads remained unavailable, including one
failed statistics Retry. A separate ordinary metrics GET returned 200 in
13,911 ms. This change removes unnecessary hidden-body reads/parsing; it does
not identify that production hot phase or establish a measured live speedup.
Further release and public verification belong to the release coordinator's next
batch; the completed app78 deployment is not replayed.

Four interactive regressions fail on the previous behavior and pass with the
change: initial four-only fetching, delayed expansion without hiding current
questions or duplicates, cancellation/discard/fresh reopen, and ten-second
visible refresh with older polling stopped on collapse. The browser fixture
checks demand loading and a withdrawn older body on reopen at 390/1440 pixels
for both network profiles, without providers, wallets or live data.
