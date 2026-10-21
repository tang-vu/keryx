# Reuse a retained arXiv PDF in its saved paper draft

A researcher can save an exact arXiv landing record while research retains the
same explicitly versioned paper's PDF URL. Previously, the draft dropped all
otherwise eligible excerpts because those two URLs differed. Four regression
cases reproduced the missing excerpt, extractive export and assessment paths on
the prior source.

The shared draft transformation now maps only canonical HTTPS arXiv PDF URLs,
with an explicit version and optional `.pdf` suffix, to an included canonical
landing record with the identical identifier and version. It does not fetch a
URL, infer a latest version, follow a redirect, compare titles, trust metadata
links or treat HTML as equivalent. Both modern and historical arXiv identifiers
use the existing versioned identity grammar. See the official
[identifier and version rules](https://info.arxiv.org/help/arxiv_identifier.html).

Before mapping, retained citation and evidence rows must still agree literally
on marker, source, item, original read URL and content version. Existing claim,
eligibility, seed and synthetic-record exclusions remain. The bibliography URL
and original PDF `readUrl` both enter the mapped excerpt identity and literal
user-assessment binding. An original URL change invalidates its old selection.
Exact-URL excerpts retain their existing shape and identifiers.

Markdown/LaTeX quote exports show the original read URL; BibTeX/RIS cite the
single saved paper record. The editor, authenticated stateless API and both MCP
tools reuse this transformation. Private draft JSON may retain an optional
assessment read URL; old strict clients can refuse that new assessment and must
not silently discard its binding. The completed-private-read selector, private
storage, purchase/reward eligibility and original payment records are unchanged.
Desktop uses the existing web view; CLI callers use the same API/MCP contract;
extensions and bots retain their documented handoffs. No new native bridge,
schedule, provider/model request, account storage or financial action is added.

Checks cover same-version reuse, legacy identifiers, exact ledger matching,
foreign hosts/credentials/ports, unversioned and changed versions, URL wrappers,
unchanged input, stale selections, assessment restore and reference parity. These
are controlled supplied-report regressions, not a fresh original-paper read,
semantic accuracy measurement or independent customer acceptance. Source/CI
completion and the coordinator's verified deployed delivery remain separate.
