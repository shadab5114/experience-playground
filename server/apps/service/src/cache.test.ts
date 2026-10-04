import { describe, expect, test } from "vitest";
import type { CompositionStore } from "@experience-agent/core";
import { withListCache } from "./cache";

function countingStore(): { store: CompositionStore; calls: () => number } {
  let calls = 0;
  const store: CompositionStore = {
    list: async (filter) => {
      calls += 1;
      return [{ compositionId: `call-${calls}`, name: filter?.q ?? "all", type: "plan-tile", tags: [] }];
    },
    get: async () => null,
    placements: async () => [],
    search: async () => [],
    types: async () => ["plan-tile"],
  };
  return { store, calls: () => calls };
}

describe("withListCache", () => {
  test("serves a repeat list from the cache, per filter", async () => {
    const { store, calls } = countingStore();
    const cached = withListCache(store, 1_000, () => 0);

    await cached.list();
    await cached.list();
    expect(calls()).toBe(1);

    // A different filter is a different entry.
    await cached.list({ q: "basic" });
    expect(calls()).toBe(2);
  });

  test("a stale entry is refetched", async () => {
    const { store, calls } = countingStore();
    let now = 0;
    const cached = withListCache(store, 1_000, () => now);

    await cached.list();
    now = 999;
    await cached.list();
    expect(calls()).toBe(1);
    now = 1_000;
    await cached.list();
    expect(calls()).toBe(2);
  });

  // Without this, a save stays invisible for up to the TTL and reads as a lost save.
  test("invalidate() drops every entry, so the next read is fresh", async () => {
    const { store, calls } = countingStore();
    const cached = withListCache(store, 1_000, () => 0);

    await cached.list();
    await cached.list({ q: "basic" });
    expect(calls()).toBe(2);

    cached.invalidate();
    await cached.list();
    await cached.list({ q: "basic" });
    expect(calls()).toBe(4);
  });

  test("a zero TTL turns caching off but still answers invalidate()", async () => {
    const { store, calls } = countingStore();
    const cached = withListCache(store, 0);

    await cached.list();
    await cached.list();
    expect(calls()).toBe(2);
    expect(() => cached.invalidate()).not.toThrow();
  });

  test("reads that are not the picker list are passed straight through", async () => {
    const { store } = countingStore();
    const cached = withListCache(store, 1_000);
    expect(await cached.get("basic-plan-tile")).toBeNull();
    expect(await cached.placements("basic-plan-tile")).toEqual([]);
    expect(await cached.search("basic")).toEqual([]);
  });
});
