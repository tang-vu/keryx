# Topic-watch list response ordering

Each mounted watch editor accepts only the newest list refresh in its current
owner epoch. Both response and JSON-body waits belong to that request. An older
success cannot restore old rows or clear a newer error; an older failure cannot
erase a newer list.

Starting a mutation invalidates earlier pending list reads immediately, including
while its acknowledgement is still pending. An accepted mutation retains its
existing canonical list refresh. The manual Refresh control also respects the
existing synchronous mutation lock before another click can start a request.
This orders client observations; it does not certify server snapshot freshness.

Focus, auth notices, broadcasts, wallet changes and unmount keep their existing
privacy invalidation. They clear private drafts, consent, results and rows, and
late responses cannot restore them. Expected-wallet headers, server If-Match
checks and revision-bound one-use current-metadata consent remain authoritative.
No route, storage, schedule, budget, paid check, retry or background request was
added. Web and desktop use the same browser editor; API/CLI/MCP controls retain
their existing contracts and roles.
