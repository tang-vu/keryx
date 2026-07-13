// Shared config for the Keryx browser extension. Loaded first by popup.html and imported by the
// service worker. Point KERYX_ORIGIN at a local dev server to test against a branch.
const KERYX_ORIGIN = "https://keryx.cc";
const KERYX_API = `${KERYX_ORIGIN}/api/v1/chat/completions`;
const KERYX_REGISTER = `${KERYX_ORIGIN}/register`;

// Storage key the service worker uses to hand a context-menu selection to the popup window.
const KERYX_PENDING_KEY = "keryx_pending";
