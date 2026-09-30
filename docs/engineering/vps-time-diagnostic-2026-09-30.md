# VPS time diagnostic ? September 30, 2026

Status: native KVM PHC capability and a no-control chrony measurement verified;
durable clock repair remains open. This diagnostic installed no package, activated
no service, adjusted no clock, introduced no persistence and performed no payment.
It preserves the earlier [funded withdrawal evidence](creator-funded-withdrawal-drill.md)
and does not close its clock or production release gates.

## Observed host and native clock evidence

The production VPS uses Linux `6.8.0-31-generic`, KVM and `kvm-clock`.
Timesyncd remained active/running, with `NTP=yes` and `NTPSynchronized=no`.
Earlier bounded UDP123 probes to Ubuntu, Cloudflare and Google timed out;
packet count remained zero despite host OUTPUT ACCEPT and inactive ufw.
Those probes were not repeated indiscriminately during this diagnostic.

A reversible `modprobe ptp_kvm` exposed `/dev/ptp0`, named `KVM virtual PTP`.
Eight read-only native `clock_gettime` samples over seven seconds measured PHC
approximately 764.18 ms ahead of guest time, with read brackets of 57 microseconds
to 1.75 ms. The [Linux 6.8 driver](https://raw.githubusercontent.com/torvalds/linux/v6.8/drivers/ptp/ptp_kvm_x86.c)
obtains wall-clock timestamps from a KVM host hypercall. This proves a working
host-to-guest virtual PHC path, not that the provider host is correctly disciplined
to UTC. RTC, guest and PHC agreement is not independent UTC evidence.

After all measurements exited, `fuser` found no PHC users. The introduced module
was unloaded without force; `/dev/ptp0` was absent again. No module persistence was
created. Timesyncd retained its original active/running, unsynchronized state.

## Extracted package and no-control validation

The Ubuntu noble-updates amd64 package `chrony 4.5-1ubuntu4.2` was downloaded with
APT and extracted with `dpkg-deb -x`, without installation or maintainer-script
execution. Its SHA256 matched APT package metadata:

```text
434f9fda4bf0de2d0c89c132a0b2c1ddda2fdd50c2b0338e1422d015c45d72d2
```

The cached noble-updates InRelease had a valid Ubuntu Archive Automatic Signing
Key (2018) signature, verified with the distribution archive keyring. That index
was dated July 3, 2026; signature validity does not establish current repository
freshness or that this is the latest available security package. No `apt update`
was performed. No insecure/weak repository override was enabled.

Private artifacts are retained under
`/root/.local/share/keryx-time-diagnostics-20260930`: package, policy and metadata,
hash and signature output, candidate, parser output, measurement logs, coarse UTC
observations, report and module rollback record. They contain no credentials or
payment journal data and are not release artifacts.

From that directory, the extracted executable passed:

```sh
./extracted/usr/sbin/chronyd -p -f /root/.local/share/keryx-time-diagnostics-20260930/candidate.conf
./extracted/usr/sbin/chronyd -Q -d -u root -t 25 -f /root/.local/share/keryx-time-diagnostics-20260930/candidate.conf
```

The bounded second command reported `Disabled control of system clock`, then
`System clock wrong by 0.765608 seconds (ignored)`, and exited. The initial attempt
without `-u root` refused because the uninstalled package's `_chrony` account did
not exist; no account was created. The root override was diagnostic only, not a
proposed production service identity. Chrony's [exact-version manual](https://chrony-project.org/doc/4.5/chronyd.html)
documents `-p` parsing and `-Q` offset measurement without clock corrections.

The parsed candidate was:

```conf
refclock PHC /dev/ptp0 poll 3 dpoll 0 refid KVM
leapsecmode slew
maxslewrate 1000
maxdrift 500
maxchange 2 0 0
port 0
cmdport 0
pidfile /root/.local/share/keryx-time-diagnostics-20260930/diagnostic.pid
```

This is a diagnostic candidate, not an installed production configuration. It has
no includes, `makestep`, `initstepslew`, `local` or `manual`. `leapsecmode slew`
avoids a configured leap-second step; `maxslewrate` bounds correction speed and
`maxchange 2 0 0` refuses an offset above two seconds from the first update.
Those limits are proposed operational choices, not accepted policy. Consult the
[chrony 4.5 configuration manual](https://chrony-project.org/doc/4.5/chrony.conf.html).
Production arguments must exclude `-q` and `-s`. `-R` alone is insufficient because
it does not suppress negative-limit `makestep`. Privileged operators can still
change time deliberately; configuration does not remove that authority.

## Independent coarse UTC corroboration

One bounded observation set used certificate-verified HTTPS, unique cache-busting
query parameters and `Cache-Control: no-cache, no-store` plus `Pragma: no-cache`
for vendor Date reads. Values below compare the received whole-second timestamp
with the guest request midpoint, not an authoritative time-transfer estimate.

| Source | Observation | Timestamp minus guest midpoint | Request duration |
| --- | --- | --- | --- |
| GitHub API | HTTP 200, Date `2026-09-30T16:33:09Z`, Age absent | +0.163 s | 0.280 s |
| Cloudflare | HTTP 200, Date `2026-09-30T16:33:10Z`, Age absent, CF-Cache-Status MISS | +0.802 s | 0.441 s |
| Arc testnet RPC | `eth_getBlockByNumber` latest, block 64805472, timestamp 1790785989 | -0.565 s | 0.291 s |

An initial Arc request received HTTP 403; the bounded retry with a conventional
User-Agent returned the actual block. Date has second-level granularity; absent
Age is not proof against caching. Network asymmetry, server implementation and
block-production timing limit these observations. They broadly corroborate current
guest time, but neither authenticate provider host discipline nor establish
long-term accuracy. No recurring HTTP-time scheduler or clock correction was made.

## Remaining acceptance and rollback gates

Before selecting this repair, obtain evidence of provider host UTC discipline,
its monitoring and migration/leap handling, or explicitly review the provider-clock
trust residual. That residual remains unaudited and unaccepted here. If that source
cannot be accepted, the concrete prerequisite is a provider-supported reachable
NTP source or repaired UDP123 request/response connectivity, with measured valid
responses; HTTPS Date checks are not a replacement clock service.

A controlled installation still requires fresh authenticated package metadata,
review of package startup hooks and service arguments, explicit prevention of
default step-enabled startup, dedicated configuration with no inherited stepping
directives, appropriate PHC access for the service identity, and exactly one active
clock controller. Native parsing and a no-control measurement do not validate
production service permissions or actual clock discipline.

Then demonstrate selected PHC source, shrinking remaining correction, stable
frequency/skew, applicable leap handling, restart and reboot persistence, and
failure/alert behavior before declaring durable synchronization. A 1000 ppm slew
would take at least about 13 minutes to absorb the observed 0.766 s offset;
real convergence may take longer. Preserve existing payment freshness bounds.

For a future rejected repair, stop only the introduced clock service, restore
recorded timesyncd state/configuration, remove only newly introduced configuration
and module persistence, and unload the module only after proving no PHC users.
Restoring the currently unsynchronized timesyncd state does not itself repair time.
Never roll back payment journals, erase locks, alter signed originals or relax
freshness checks as part of clock recovery. No production restart or funded
operation is authorized by this diagnostic document.
