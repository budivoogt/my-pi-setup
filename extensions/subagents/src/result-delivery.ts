export function createDeferredResultDelivery<
  T extends { id: string; runSequence?: number },
>() {
  const pending = new Map<string, T>();

  const keyFor = (result: { id: string; runSequence?: number }) =>
    `${result.id}:${result.runSequence ?? 0}`;

  return {
    defer(result: T) {
      pending.set(keyFor(result), result);
    },
    consume(results: Iterable<{ id: string; runSequence?: number }>) {
      for (const result of results) pending.delete(keyFor(result));
    },
    drain() {
      const results = [...pending.values()];
      pending.clear();
      return results;
    },
    clear() {
      pending.clear();
    },
  };
}
