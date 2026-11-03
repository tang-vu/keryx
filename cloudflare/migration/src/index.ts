import { previewResponse } from "./preview-policy.mjs";

declare const __KERYX_SOURCE_COMMIT__: string;

export default {
  async fetch(request: Request, env: { MIGRATION_PREVIEW_TOKEN?: string;
    ASSETS: { fetch(request: Request): Promise<Response> } }, context: unknown): Promise<Response> {
    return previewResponse(request, env,
      async () => {
        // User-worker-first admission also covers assets. Serve the bound static
        // files only after the gate, then hand application routes to the renderer.
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return asset;
        await asset.body?.cancel();
        const { default: application } = await import("vinext/server/fetch-handler");
        return Reflect.apply(application.fetch, application, [request, env, context]);
      }, __KERYX_SOURCE_COMMIT__);
  },
};
