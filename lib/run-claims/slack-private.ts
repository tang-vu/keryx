/** Signed response_url is a sender-private delivery capability, not a public
 * room destination. Validate transport before an enabled run can spend. */
export function privateSlackResponseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.href === value && url.protocol === "https:" && url.hostname === "hooks.slack.com" && !url.port
      && !url.username && !url.password && !url.search && !url.hash && url.pathname !== "/";
  } catch { return false; }
}
