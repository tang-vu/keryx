import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Plugin } from "esbuild";
const require = createRequire(import.meta.url);
const rewrite = require("./circle-sdk-browser-loader.cjs") as (source: string) => string;

/** Hermetic component/browser checks use the same scoped transform as Next. */
export function circleSdkBrowserPlugin(): Plugin {
  return { name: "circle-sdk-browser", setup(build) {
    // Older hermetic fixtures do not configure this optional provider. Preserve that
    // explicit absence instead of leaving new public env references in a browser.
    const definitions = build.initialOptions.define ??= {};
    definitions["process.env.NEXT_PUBLIC_CIRCLE_APP_ID"] ??= '""';
    definitions["process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID"] ??= '""';
    build.onLoad({ filter: /[\\/]@circle-fin[\\/]w3s-pw-web-sdk[\\/]dist[\\/]src[\\/]index\.js$/ }, async args => ({
      contents: rewrite.call({ resourcePath: args.path }, await readFile(args.path, "utf8")), loader: "js", resolveDir: dirname(args.path),
    }));
  } };
}
