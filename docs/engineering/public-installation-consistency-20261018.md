# Installation selectors follow canonical release roles

Public QA of app 0.27.77 found the integration example still pinned stdio MCP
0.4.31. The same source selected the v0.27.76 Operator release, while the download
label named Operator 0.4.29. The public v0.27.77 release already contained the
accepted Operator 0.4.30 assets and MCP 0.4.32 package.

The Operator release links now use the application package version; the desktop
label uses the desktop package version and containing application release. The
stdio example uses the MCP package's own name and version. The extension's
independent published ZIP pin and historical archived labels remain intact.
No package, lockfile, registry, desktop version or payment role is changed.

The direct Vietnamese/Chinese machine draft label templates and their existing
source bindings are regenerated. Runtime version identifiers use the existing
UiText English fallback for interpolated values; a preview cannot restore stale
numeric versions. No translation approval or activation is implied.

Five regression cases compare the selectors, English label and both preview
outputs with independent canonical package metadata. All five fail on the
pre-fix source and pass after the correction. Existing product-guide browser
checks consume these same public selectors and retain their installation and
custody boundaries. Required CI and independent review precede ROOT's serialized
merge; accepted source awaits the next deployment batch without a separate
version, publication or deployment.
