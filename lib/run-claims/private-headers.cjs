/** Plain JavaScript so config and route evaluation share the exact headers. */
const runClaimPrivateHeaders = [
  { key: "Cache-Control", value: "no-store" }, { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

module.exports = { runClaimPrivateHeaders };
