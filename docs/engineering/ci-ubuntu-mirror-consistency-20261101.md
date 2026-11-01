# Hosted Ubuntu browser dependency consistency

Two actual CI failures exposed different runner/repository inputs. The post-merge
font repair's production job ran on an AWS hosted Ubuntu image and refused its
mirror list before any privileged write; the original list was not logged. The
language UI's second unit shard later rejected a `noble-updates` index fetched
from the security mirror because its size differed from the signed metadata.
Those failed runs remain failures.

The setup recognizes the existing fixed Azure list, the already owned HTTPS list
and the same fixed priority layout with Canonical's regional EC2 Ubuntu endpoint.
Only supported official Ubuntu hosts, repository paths and priorities qualify.
All qualifying initial lists still become the same two fixed official HTTPS
destinations. Unknown configurations refuse before writes and report a bounded
summary without credentials, queries, fragments or unexpected repository paths.
The actual unlogged AWS list must still be checked by live CI; a regional format
fixture alone does not establish that historical file's contents.
Successful CLI setup reports the sanitized original mirror identities after every
planned file has passed readback, so current hosted input variants can be verified.

The first repair candidate also refused an ordinary two-stanza source file whose
main and security pockets both use the hosted mirror list. Its new strict parser
had omitted that previously supported shape. The corrected parser requires one
exact main-suite group and one exact security pocket, accepting the shared mirror
URI in both while preserving each stanza's metadata and every refusal gate.
Current hosted execution is still required; the failed first candidate stays failed.

Each validated Ubuntu source stanza receives `By-Hash: force`. This requests an
index through its expected hash rather than a mutable index filename, avoiding
cross-mirror index publication races when the requested immutable index exists.
The setting is scoped to the validated Ubuntu stanzas, so unrelated third-party
APT repositories keep their policy. Ubuntu's keyring, source types, components,
suites and architectures remain checked. No authentication, TLS, hash or package
assertion is disabled. Transport bounds and the real Chromium install remain.

The [APT source documentation](https://manpages.debian.org/bookworm/apt/sources.list.5.en.html)
defines the per-source setting and mirror-support requirement.
[Canonical cloud-init](https://github.com/canonical/cloud-init/blob/main/config/cloud.cfg.tmpl)
documents regional EC2 Ubuntu names; the
[GitHub image setup](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh)
documents the original prioritized layout. Current hosted success is required in
addition to synthetic guard/idempotency/failure tests. This changes CI setup only;
it authorizes no local APT operation, production mutation, funding or test waiver.
