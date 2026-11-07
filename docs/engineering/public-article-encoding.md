# Public article character decoding

The original reader decoded every non-PDF response as UTF8 after discarding the
HTTP charset. A synthetic Windows-1252 publisher original reproduced `Café`
becoming `Caf�` through the actual HTML worker. That changed source wording before
quote extraction and citation support checks.

`fetchPublicBytes` now retains the terminal response's optional MIME `charset`
parameter, bounded to 64 characters. It uses Node's MIME parser for quoted values,
case and duplicate parameters; redirect headers never become final metadata.
Request headers, vetted DNS/socket addresses, redirects, status/type admission,
timeouts and byte limits are unchanged. The whole untrusted header is not retained.

The shared article decoder observes BOM first, then a recognized HTTP label.
For `text/html`, the existing pinned HTML sniffer also checks declarations in the
first 1024 bytes, following the [HTML encoding algorithm](https://html.spec.whatwg.org/multipage/parsing.html#determining-the-character-encoding).
Other formats do not interpret HTML meta markup. Undeclared or unsupported labels
retain the existing UTF8 fallback; there is no language, URL or statistical guess.
Nonfatal decoding follows the Encoding Standard, including its replacement rules.
This does not add XML-prolog detection or claim browser parity for declarations
outside the bounded HTML prescan.

The same decoder serves ordinary public reads and explicit historical backfill.
The backfill's zero-hop/full-response, consent, checkpoint and archive-write
controls remain intact. PDF bytes stay on their existing path. Plain/Markdown
raw bytes still cap at 500000; decoded HTML still has its existing 2 MiB input
bound, 500000 normalized-byte bound and isolated worker. Output remains a bounded
excerpt with existing Unicode-prefix, provenance and citation/reward gates.
Decoding can change bytes into equal Unicode strings; it does not establish raw
byte identity, factual truth, permission or settlement.

`html-encoding-sniffer` 6.0.0 and `@exodus/bytes` 1.16.0 were already production
dependencies through jsdom. They are now declared directly at those exact locked
versions; only a development type declaration is new. Every existing locked
package/version is preserved. No new DOM parsing occurs in the parent process.

Regression fixtures cover Windows-1252/Latin1 labels, GBK, Shift_JIS, Big5,
Windows-1251, UTF8/UTF16 BOM precedence, HTTP/meta conflicts, ineligible meta
markup and unchanged caps. The actual article/backfill paths preserve exact
Unicode; raw fixtures are also compared with Chromium. A fresh 64 MiB Node process
executes the CJS bundle while rejecting every external package load, preventing
an unnoticed workspace dependency fallback. These are synthetic offline fixtures,
not new provider calls, paid research, customer outcomes or a production rollout.

The server reader serves the existing web/API and client handoffs. CLI, remote/
stdio MCP, embedded desktop, extension and bot roles and public schemas are
unchanged; this does not add a local document reader to a hosted client.
Source acceptance still requires the applicable full CI/platform checks. Runtime version allocation,
publication and deployment remain with the existing release owner and explicit
user command.
