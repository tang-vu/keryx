// Pinned Next's existing cache preserves immutable build-seed reads and bounded
// process memory. Runtime writes never reach the code cohort. Optimized images
// retain their HTTP behavior but are recomputed rather than persisted there.
const FileSystemCache = require('next/dist/server/lib/incremental-cache/file-system-cache').default;
module.exports = class ImmutableNextCache extends FileSystemCache {
  constructor(context) {
    super({ ...context, flushToDisk: false, maxMemoryCacheSize: 16 * 1024 * 1024 });
  }
  async get(key, context) {
    return context?.kind === 'IMAGE' ? null : super.get(key, context);
  }
  async set(key, data, context) {
    if (context?.kind === 'IMAGE' || data?.kind === 'IMAGE') return;
    return super.set(key, data, context);
  }
};
