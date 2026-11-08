# Public service boot inventory

The November 8 origin outage followed a VPS reboot: Cloudflare was running, but
the application roles and the independent front door were absent. Their existing
systemd boot units had been disabled. Checking a running PM2 PID alone cannot
detect this persistence gap before the next reboot.

For the approved public ingress through front door3938 to application3939, run on
the VPS:

```sh
node scripts/release-ops-preflight.mjs --public-boot-only --require-front-door
```

This mode reads only `LoadState`, `ActiveState`, `MainPID` and `UnitFileState` for
`pm2-root.service`, `cloudflared.service` and
`keryx-maintenance-front-door.service`. It does not read ENV, invoke PM2, query
cron, activate held private workers or inspect financial state. It never starts,
enables, restarts or modifies a service. Any failed check sets exit code1;
invalid or contradictory flags set exit code2 before any host read.

Both the tunnel and the required front door must be running with positive PIDs
and persistently enabled. PM2's boot unit must be persistently enabled, but may
be inactive when the currently serving daemon was started outside systemd.
This is a boot-configuration check: boot-only mode does not establish that the
named application roles are running, that the saved PM2 dump matches their
approved definitions, or that a fresh process meets financial/custody prerequisites.
Verify those separately under the existing release owner before maintenance.

The full existing `npm run preflight:ops` inventory now includes the PM2 and
tunnel boot checks, alongside its existing named PM2 PID, cron, private worker,
withdrawal and alert checks. Add `-- --require-front-door` for ingress3938.
Existing intentional scheduler/private-worker holds can still make the full
inventory fail; do not activate them to silence a failure. Use the boot-only mode
for a scoped public boot check.

When ingress goes directly to the application, omit `--require-front-door`. The
front door then reports informational route uncertainty and is not queried.
The operator must verify the actual ingress route before choosing this option.
An absent front-door requirement cannot prove the front door is healthy.

Only `UnitFileState=enabled` is accepted for these approved standalone units.
Missing, masked, linked, static, transient or runtime-only enabled units require
owner review; a successful `systemctl is-enabled` exit code is insufficient.
See the [systemd unit-file state definitions](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html#is-enabled%20UNIT%E2%80%A6).
This does not assert that every static/dependency-triggered systemd unit is broken;
such an alternative startup topology needs its own reviewed evidence.

This inventory does not reboot the VPS or test actual post-reboot recovery. Keep
the approved source, saved role definitions, protected ENV/custody and disabled
research schedules unchanged. Service lifecycle changes and application releases
remain separate authorized operations under the existing release owner.
