# Private worker supervision and deployment drill

Implemented in `84160d5ae115d4ad2fe12c555d49520a9ad18d8b`, deployed on September 10, 2026.

## Host and service evidence

The existing VPS reported systemd 255 and a running system manager. Initially no private
service was installed and no private lock existed. The committed unit passed the host's
`systemd-analyze verify` before installation. Loaded properties confirmed:

- `TimeoutStopUSec=infinity`, `SendSIGKILL=no`, `Restart=no`.
- Explicit Node environment-file loading, with worker/research flags scoped to the service.
- Read-only system/home protections with the existing data directory writable.

The unit was installed and enabled for boot. A real start reached idle with matching policy
and build, 100000 micro-USDC available and required backing, and no treasury pool. Initial
startup observations were stale or stopped and correctly exited nonzero; systemd-active state
was not substituted for readiness. Later inspection succeeded after the actual worker began
polling.

The deployment helper stopped that active service. Systemd then reported inactive, MainPID 0
and exit status 0, and the cooperative lock was absent. Resuming created a different live
process and subsequently matched idle inspection again. Empty recovery/reconciliation/execution
ticks had zero jobs, payments and errors. This was an idle lifecycle drill, not a paid-job drain.

## Full deployment observation

`npm run redeploy` ran the new stop helper before syncing source to `84160d5`. During build,
independent systemd inspection confirmed inactive state, MainPID 0 and no private lock. The
web application continued serving its previous build. After TypeScript and production build
succeeded, the web health gate passed and only then did the script resume the private service.

Final observations showed the service active/running and the operations inspector exiting zero:
matched idle worker, fully backed 100000-micro-USDC capacity, no existing treasury pool and
`checkoutReady: false`. Public health reported `84160d5` and `operational`.

At `2026-09-10T09:29:41.764Z`, a temporary SIWE session independently verified that worker
supervision did not enable web checkout: anonymous purchase returned 401, authenticated purchase
returned the disabled 503 response, foreign Origin returned 403 and the disabled quote returned
503. Sign-out was confirmed. No payment typed-data signature was created.

## Tests and remaining limits

Hermetic shell tests passed for absent/inactive services, successful drain/resume, failed stop,
still-active results, failed/transitional/masked states and invalid resume state. Shell syntax
checks passed. CI `34459648579` completed successfully, including the new deployment checks.

The managed worker remains running with purchasing disabled. Automatic crash restart is disabled;
a retained lock and original claims require operator inspection. Boot enablement is configured,
but a reboot was not performed. No active paid-job shutdown, crash recovery, alert delivery,
general checkout availability or mainnet readiness is established by this drill. This remains
the current root-owned, single-host operational layout.
