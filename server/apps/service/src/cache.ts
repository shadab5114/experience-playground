// Short-lived in-memory cache for the picker list. Only list() is cached;
// single-composition and placement reads always go to Postgres.
//
// Methods are forwarded by hand, so a method added to CompositionStore would be
// silently dropped here. That is why Studio writes went into their own port
// (AuthoringStore) instead of growing this one.
import type { CompositionStore } from "@experience-agent/core";

// invalidate() drops the cached lists. Authoring writes call it so a save is
// visible on the next read instead of up to ttlMs later, which otherwise reads
// to the designer as "my save didn't work".
export interface CachedCompositionStore extends CompositionStore {
  invalidate(): void;
}

export function withListCache(
  store: CompositionStore,
  ttlMs: number,
  now: () => number = Date.now,
): CachedCompositionStore {
  const entries = new Map<string, { at: number; value: Awaited<ReturnType<CompositionStore["list"]>> }>();
  const cacheDisabled = ttlMs <= 0;

  return {
    list: async (filter) => {
      if (cacheDisabled) return store.list(filter);
      const key = JSON.stringify(filter ?? {});
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      const value = await store.list(filter);
      entries.set(key, { at: now(), value });
      return value;
    },
    get: (id) => store.get(id),
    placements: (id) => store.placements(id),
    search: (text) => store.search(text),
    types: () => store.types(),
    invalidate: () => entries.clear(),
  };
}
