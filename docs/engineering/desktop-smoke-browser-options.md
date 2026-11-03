# Explicit browser options for desktop acceptance

PR795's two unchanged packaged runs failed to expose the CDP endpoint before the
existing startup deadline. Both standard-user tokens were non-elevated at medium
integrity. The second owned app window was responsive; WMI process diagnostics
timed out. These observations do not establish a runtime-version or elevation
cause. Original diagnostics are retained separately from this source change.

The smoke launcher now supplies its numeric debug port in the existing validated
fixture, and the native host passes the port and isolated profile through the
pinned Tauri WebView API. It no longer relies on `WEBVIEW2_*` environment overrides
for these test options. This is a proposed fixture correction; actual packaged
acceptance must determine whether it resolves the observed failure.

Only a regular, bounded `smoke.json` inside the existing fresh canonical fixture
can activate it. Ports must be integers from 1024 through 65535; arbitrary switches
are not accepted. Each port gets a distinct `webview-data-<port>` child directory.
An existing profile must remain a physical directory within the validated root.
This follows the pinned Tauri builder's requirement that different browser
arguments use different data directories. Its pinned Wry default switches are
preserved alongside the loopback-only debug port.

Without a validated fixture/debug port, no browser arguments or profile overrides
are added. Ordinary navigation, new-window refusal, private helper authority,
payments and user settings are unchanged. No machine policies, runtime downgrade,
elevated app launch or longer startup deadline is introduced. Keep the 156+ runner
fixture and every portable/installed/fresh-consumer assertion. No local machine
account or installed runtime is changed by this source task.

The [upstream elevated-host report](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645)
documents an API option channel but does not prove the cause in these measured
non-elevated fixtures. Required full CI and actual native acceptance remain
mandatory; a successful compile or configuration test alone does not qualify
packaged startup or authorize a release.
