import type { BrowserContext } from "playwright";

/** Keep the context alive for pending proxies while blocking new page requests. */
export async function drainBrowserRoutes(context: BrowserContext): Promise<void> {
  // Page routes take precedence and remain installed when context routes are removed.
  // This keeps the network fence in place while existing route.fetch calls finish.
  for (const page of context.pages()) await page.route("**/*", route => route.abort("aborted"));
  await context.unrouteAll({ behavior: "wait" });
}
