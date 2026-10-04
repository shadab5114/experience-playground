import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { createPool, PostgresThreadLock } from "./index";
import { resetTestDatabase, testConnection } from "./testing";

let pool: pg.Pool;
let lockPool: pg.Pool;

beforeAll(async () => {
  pool = await resetTestDatabase();
  lockPool = createPool(testConnection(), { max: 4, connectionTimeoutMillis: 1_000 });
});

afterAll(async () => {
  await Promise.all([pool.end(), lockPool.end()]);
});

describe("PostgresThreadLock", () => {
  test("only one holder per thread; a second try gets null until release", async () => {
    const lock = new PostgresThreadLock(lockPool);
    const first = await lock.tryAcquire("lock-one");
    expect(first).not.toBeNull();

    expect(await lock.tryAcquire("lock-one")).toBeNull();

    await first!.release();
    const again = await lock.tryAcquire("lock-one");
    expect(again).not.toBeNull();
    await again!.release();
  });

  test("different threads do not block each other", async () => {
    const lock = new PostgresThreadLock(lockPool);
    const a = await lock.tryAcquire("lock-a");
    const b = await lock.tryAcquire("lock-b");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    await Promise.all([a!.release(), b!.release()]);
  });

  test("release is safe to call twice", async () => {
    const lock = new PostgresThreadLock(lockPool);
    const held = await lock.tryAcquire("lock-twice");
    await held!.release();
    await expect(held!.release()).resolves.toBeUndefined();
    const next = await lock.tryAcquire("lock-twice");
    expect(next).not.toBeNull();
    await next!.release();
  });

  test("the lock is visible to another connection only while held", async () => {
    // A lock taken on one pool must block the same thread through another pool,
    // because the lock lives in Postgres, not in this process.
    const otherPool = createPool(testConnection(), { max: 1 });
    const other = new PostgresThreadLock(otherPool);
    const held = await new PostgresThreadLock(lockPool).tryAcquire("lock-shared");
    expect(held).not.toBeNull();
    expect(await other.tryAcquire("lock-shared")).toBeNull();
    await held!.release();
    const free = await other.tryAcquire("lock-shared");
    expect(free).not.toBeNull();
    await free!.release();
    await otherPool.end();
  });
});
