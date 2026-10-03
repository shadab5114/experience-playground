// Short-lived in-memory cache for the picker list. Only list() is cached;
// single-composition and placement reads always go to Postgres.
import type { CompositionStore } from "@experience-agent/core";

export function withListCache(
  store: CompositionStore,
  ttlMs: number,
  now: () => number = Date.now,
): CompositionStore {
  if (ttlMs <= 0) return store;
  const entries = new Map<string, { at: number; value: Awaited<ReturnType<CompositionStore["list"]>> }>();

  return {
    list: async (filter) => {
      const key = JSON.stringify(filter ?? {});
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      const value = await store.list(filter);
      entries.set(key, { at: now(), value });
      return value;
    },
    get: (id) => store.get(id),
    placements: (id) => store.placements(id),
  };
}
