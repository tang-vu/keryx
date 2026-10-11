# iPhone header navigation and wallet selection

Owner report: Safari on iPhone showed slow header navigation and neither MetaMask
nor WalletConnect reacted to selection. A real React/Radix touch fixture reproduced
the wallet failure: the document outside-click handler dismissed the mobile menu
on the synthetic mouse event before the portaled wallet button received its click.

The header now recognizes its own wallet portals and handles outside touches with
pointer events. After first opening, the mobile wallet control remains mounted
when its outer menu hides. Vendor modals and return from a wallet app therefore
retain the selected wallet's one-time sign-in intent. SDK initialization still
requires explicit selection or the existing verified restoration flow. Connect
errors are handled through the promise, so closing the picker cannot remove its
error callback; pending connection has a visible status.

Internal navigation hides the mobile menu as soon as navigation starts. The
public data pages `/dashboard`, `/sources` and `/market` have prefetchable loading
shells, enabling partial prefetch and streaming while data loads. Static pages
keep Next's automatic prefetch. Private research documents and routes with dynamic
not-found semantics keep their existing boundaries. This is responsiveness work,
not a measured reduction in database or network latency.

`npm run test:browser-mobile-header` tests actual header/picker/Radix components
with touch events, delayed synthetic connector outcomes, an external body modal,
exactly one subsequent sign-in, navigation start, outside dismissal and Escape.
Use `-- --webkit` for the WebKit engine. All auth/connector transport is synthetic;
these checks do not prove a physical iPhone can open an installed wallet app.
The built-navigation check runs actual Next against a disposable offline store,
permits only GET requests, and withholds the final Sources response after its
partial prefetch. Loading must be visible before that response is released, the
ordinary header must return afterward, and an unrelated missing route must retain
HTTP 404. The temporary loading header offers no wallet control whose connection
intent could be lost when it is replaced.

Surface audit: web and browser wallet handoffs from desktop/extension benefit from
the hosted UI repair. Desktop/CLI, remote and stdio MCP, public/private APIs,
extension packaging and bots retain their contracts and signing roles. No shared
payment, storage, custody, network or session-cap behavior changes; their package
versions do not need new bytes for this web-only correction. App candidate is
0.27.58. Hosted CI, deployed health and physical-device acceptance are independent
gates; local fixtures alone do not establish delivery.
