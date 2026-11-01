# Desktop bundled-font acceptance readiness

The hermetic Desktop UI check must explicitly load its three declared bundled
font families before checking them. `document.fonts.ready` covers fonts needed by
the current layout; an asynchronous React screen can introduce another family
after that promise resolves. An unused declared face can therefore still make
`document.fonts.check` return false even when its bundled resource is valid.

The check calls `document.fonts.load` for Bodoni Moda, Spectral and Spline Sans
Mono, then awaits layout readiness and retains its existing checks. Each load must
return at least one face and every returned face must be loaded. This also refuses
an undeclared family, for which `check` alone can succeed through fallback.
Failed or malformed font resources still reject the check. No retry, sleep,
timeout extension, fallback font, renderer or package change is introduced.

The [CSS Font Loading specification](https://www.w3.org/TR/css-font-loading-3/#font-face-set-ready)
describes the distinction between layout readiness and explicit font loading.
Acceptance includes actual bundled resources with delayed delivery, missing font
definitions and missing/corrupt resource refusals, followed by the existing full
Desktop UI smoke and required PR/domain/main acceptance. This CI-only correction
does not allocate a runtime version or authorize deployment.
