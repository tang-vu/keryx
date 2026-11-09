# Diagnose an online but unresponsive web process

PM2 `online` describes a running process, not a responsive HTTP listener. During
the November 9, 2026 incident, public home and health requests timed out while the
installed web process consumed about one CPU and its listen backlog reached 141.
The worker and Cloudflare tunnel remained up. A later V8 profile was mostly idle,
and readiness recovered without a restart. Those observations establish the
failure mechanism for that incident, but do not identify its triggering function,
prove a memory leak or establish a shared cause for every earlier alert.

Preserve the busy interval before changing the target. Enabling a V8 inspector,
collecting a heap dump or restarting first can change the state being investigated.
An idle profile taken later cannot explain an earlier CPU spike. Two successful
monitor observations establish endpoint readiness; keep the root-cause work open
when it remains unproven.

## Compare the actual HTTP paths

Record UTC time, the current installed source, both PM2 role PIDs, restart counts
and the web process start time from `/proc/<pid>/stat`. Use a bounded PM2 projection
that omits environments and full command lines. Check tunnel state, memory,
per-thread CPU and the 3938/3939 listen queues. A process RSS value alone does not
establish heap use, memory pressure or OOM; attribute historical errors to their
actual PID and time.

The private web listener validates ingress metadata before calling Next. From
the existing VPS shell, this reads only status and elapsed time:

```sh
curl --noproxy '*' --max-time 8 --silent --show-error \
  --output /dev/null --write-out '%{http_code} %{time_total}\n' \
  --header 'Host: keryx.cc' --header 'X-Forwarded-Proto: https' \
  http://127.0.0.1:3939/api/health
```

A bare loopback read, or one with only `Host`, receives 421 even when the web is
healthy. Record that as an invalid probe, not an application timeout or a reason
to restart. Do not weaken the listener's public HTTPS metadata validation. Compare
the correctly formed loopback result with a bounded public HTTPS read from another
client; retain a sanitized verdict rather than the full payment/health payload.

## A finite native sample

Qualify the installed `perf` on an owned synthetic process before relying on it.
The presence of its binary, a version string, a successful `perf stat` counter or
a sysctl value does not prove recording and symbol resolution work. Do not install
packages, lower kernel restrictions or change production launch flags as an
implicit part of sampling. Refuse unavailable recording and preserve the failure.

For an admitted incident sample, recheck the exact web PID, executable, process
start time and installed source immediately before attachment. Preserve the
worker. Use one finite, low-frequency user-mode frame-pointer recording, such as
these arguments to the existing Linux recorder:

```text
timeout --foreground --signal=TERM --kill-after=2s 12s
  perf record -e cpu-clock:u -F 49 --call-graph fp,32
  --no-inherit -m 64 -B -N -p <verified-web-pid> -o - -- sleep 2
```

This is an argument outline, not a multiline shell command. Execute it with a
binary-safe subprocess helper. Stream stdout directly into an exclusively created
private evidence file in the canonical `.local/release-evidence/<incident>/`
location; retain stderr and the actual exit status separately. PowerShell text
redirection must not transcode the binary stream. Bound the helper's elapsed time
and retained output. A deadline or nonzero recorder exit is incomplete evidence,
even if some bytes were received; do not silently relabel it or automatically
resubmit. Never send the helper's cleanup signals to the web or worker.

The fixed arguments select software CPU-clock samples in user mode, 49 samples
per second per attached task, at most 32 frame-pointer call-chain entries and
64 mmap data pages per recorder buffer. `--no-inherit` excludes newly inherited
child tasks; it does not imply one thread or one global buffer. `-B -N` avoid
build-ID collection/cache updates. This mode requests instruction/call-chain
addresses, not a heap dump, application-variable inspection, register dump,
DWARF user-stack dump, system-wide trace or inspector endpoint. Profiles still
contain process identities, mapped paths, addresses and timing; keep them private.
See the [Linux 6.8 recorder documentation](https://github.com/torvalds/linux/blob/v6.8/tools/perf/Documentation/perf-record.txt)
for recording, frame-pointer, buffering and control semantics.

Decode the retained pipe-format bytes on the matching Linux host with
`env DEBUGINFOD_URLS= perf script --show-lost-events -i -`, feeding binary stdin
and retaining its actual exit status and lost event diagnostics. Resolve only installed
binaries. Attribute samples to the verified PID/TIDs and time window. Recheck
process identity afterward; a changed PID/start time invalidates attribution to
the predecessor. Record both the sample count and unresolved frames. Missing JIT
symbols, omitted frame pointers, limited depth, dropped samples or an idle window
can prevent a useful call chain. No samples do not prove no work occurred.

## Reviewed one-shot command

`scripts/profile-public-origin.py` implements the bounded collection above for
the reviewed native, root-owned PM2 role layout. It requires Linux root and the
following operator-supplied identities from the current operational record:

```text
python3 /path/to/reviewed/profile-public-origin.py
  --web-pid <pid> --web-start <proc-start-ticks>
  --worker-pid <pid> --worker-start <proc-start-ticks>
  --daemon-pid <pid> --daemon-start <proc-start-ticks>
  --source <full-installed-source-commit>
  --config <reviewed-private-archive/roles.json>
  --config-sha256 <full-reviewed-config-sha256>
```

This is an argument outline. Pass arguments directly to a subprocess; do not
copy stale PIDs or interpolate an unreviewed shell command. The config must be a
root-owned regular file under the existing private release archives. The command
checks its digest and both exact native launch commands, then binds the current
daemon PID file, root UIDs, Node executable, web/worker parent, cwd, command line,
four source/runtime environment markers and `/proc` start ticks. It checks again
after the HTTP observation and after a recording. Other environment values are
neither reported nor copied into the recorder. These checks establish the
declared process binding, not release-artifact integrity or recovery authority.

Without `--profile`, it prints one JSON observation to stdout. It takes a native
CPU tick delta across a half-second wait and one fixed two-second loopback health
GET with the required ingress headers. It does not invoke PM2, import application
code, start a missing daemon, retry the request or inspect application variables.
Exit zero means the observation completed; inspect the HTTP status and curl exit
code separately. It is not a complete readiness, database or payment verdict.

Only an explicit `--profile` can attach the recorder, and only when the observed
web CPU rate is at least 80% of one core and the HTTP probe times out or returns
5xx. Healthy/not-busy observations skip collection; 421, redirects, other 4xx and
unrelated curl errors refuse it. There is no force switch, retry or installed
watchdog. An operator still needs the existing finite production diagnostic
scope; possession of this command does not grant attachment or recovery authority.

In profile mode, stdout contains only binary pipe-format profile bytes, including
any retained partial bytes; stderr contains the JSON verdict and recorder log.
Use separate binary-safe evidence files and retain the process exit code even on
failure. The command bounds retained stdout to 2 MiB, recorder stderr to 16 KiB
and collection to 12 seconds, followed by at most three seconds of helper cleanup.
It creates a new helper session and signals only that helper/session on a limit
or interruption, never the pinned web or worker. It disables recorder config and
build-ID cache writes. Nonzero recorder exit, a limit, missing pipe header or
changed target binding produces an incomplete/refused verdict, not a successful
capture. A valid header and exit zero still require decoding and sample attribution
before the data supports a useful diagnosis. Python documents the binary streams,
child-session and return-code behavior in its
[subprocess reference](https://docs.python.org/3/library/subprocess.html).

## Qualification on November 9, 2026

An isolated Node 24.22.1 process on the existing VPS performed synchronous crypto
using public fixture inputs. Perf 6.8.1 collected a two-second user-mode
frame-pointer pipe stream at 49 Hz. The fixture waited for the recorder's `enable`
acknowledgement before starting work and remained alive past collection. This
synchronization matters: an earlier short-lived fixture ended with recorder
SIGTERM and was retained as failed qualification, not accepted as a normal exit.
Linux documents the control acknowledgement with `--control=fd:...` and
`--delay=-1` in the same recorder reference.

The accepted recorder and decoder exited zero. Its 30,908-byte pipe stream
contained 98 samples over an observed span of 1.982 seconds, identifying the owned
fixture PID and native PBKDF2/HMAC frames. Both fixture and recorder exited; the
production web/worker PIDs and restart counts stayed unchanged, and a correctly
formed loopback health read returned 200. No production target was attached, no
inspector was enabled, and no remote profile file, build-ID cache, application
environment, dependency install or kernel setting was created or changed.

This qualifies one bounded diagnostic method on that host. It does not reproduce
the outage, identify its cause or qualify an arbitrary future target/runtime.
The [request observations during drain](public-request-observation.md) provide
separate workload aggregates when the event loop can run; they cannot explain an
earlier fully blocked loop or count requests still waiting in the kernel queue.

The implemented command was also checked against the installed roles in
observation mode, without production attachment. Its exact collector then ran on
a separate owned Node 24.22.1 crypto fixture. Recording and decoding exited zero:
27,632 bytes, 97 samples across 1.980 seconds, all attributed to the fixture PID,
with native PBKDF2/HMAC frames and no reported lost events. There were unresolved
frames; this does not establish complete JavaScript call chains. Separate real
child-process trials exceeded a reduced byte limit and a deadline; each retained
its partial bytes, reported the failure and closed its own helper. Portable unit
tests cover binding, refusal, capture decisions and both output pipes. Subsequent
checks found those helpers absent, the same production role start times, no
inspector listener and a correctly formed loopback HTTP 200. These are mechanism
checks, not an outage reproduction or proof that its trigger has been repaired.

## Recovery and closure

Recheck readiness before recovery. If the web has recovered, preserve its running
state and close any task-owned diagnostic clients/endpoints; a restart is not
required to finish diagnosis. An actual same-release recovery still needs the
existing serialized operational scope, fresh startup prerequisites, retained
originals, policy/custody/queue gates, positive drain evidence and public postflight.
Do not infer worker restart, new release, funding, policy renewal, payment/job
replay or an autonomous watchdog/schedule from an availability incident. Record
readiness recovery separately from a verified repair of the underlying cause.
