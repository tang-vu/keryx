type AbortableRoute = { abort(errorCode?: string): Promise<void> };
type ClosableContext = { close(): Promise<void> };

async function bounded(operation: () => Promise<void>, label: string, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Fixture-owned routes only. Keep the installed interceptor as the network fence
 * until close: new arrivals abort, existing proxy handlers settle, then close.
 * A deadline is a failed fixture, never successful navigation acceptance.
 */
export function createNavigationRouteDrain() {
  let draining = false;
  const held = new Set<AbortableRoute>();
  const pending = new Set<Promise<void>>();
  const failures: unknown[] = [];
  return {
    held,
    async handle(route: AbortableRoute, operation: () => Promise<void>) {
      const task = Promise.resolve().then(() => draining ? route.abort("aborted") : operation());
      pending.add(task);
      try { await task; }
      catch (error) { failures.push(error); throw error; }
      finally { pending.delete(task); }
    },
    async closeContext(context: ClosableContext, timeoutMs = 10_000) {
      draining = true;
      try {
        await bounded(async () => {
          const released = await Promise.allSettled([...held].map(route => Promise.resolve().then(() => route.abort("aborted"))));
          held.clear();
          for (const result of released) if (result.status === "rejected") failures.push(result.reason);
          while (pending.size) await Promise.allSettled([...pending]);
        }, "Navigation route drain", timeoutMs);
      } catch (error) { failures.push(error); }
      // Even a failed drain must attempt disposal. Its error stays a failure.
      try { await bounded(() => context.close(), "Navigation context close", timeoutMs); }
      catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError([...new Set(failures)], "Navigation fixture cleanup failed");
    },
  };
}
