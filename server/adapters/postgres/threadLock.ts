// ThreadLock over Postgres session advisory locks. A session lock belongs to the
// connection that took it, so the connection is held for the whole run and released
// (or destroyed, which drops the lock) when the run ends. The key is a 64-bit hash of
// the thread id, computed by the database. A collision would only make two different
// threads wait for each other, never corrupt either one.
import type pg from "pg";
import type { ThreadLock } from "@experience-agent/core";

const TRY_LOCK = "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked";
const UNLOCK = "select pg_advisory_unlock(hashtextextended($1, 0))";

export class PostgresThreadLock implements ThreadLock {
  constructor(private readonly pool: pg.Pool) {}

  async tryAcquire(threadId: string): Promise<{ release(): Promise<void> } | null> {
    const client = await this.pool.connect();
    let locked: boolean;
    try {
      const { rows } = await client.query<{ locked: boolean }>(TRY_LOCK, [threadId]);
      locked = rows[0]?.locked === true;
    } catch (err) {
      client.release(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
    if (!locked) {
      client.release();
      return null;
    }

    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        try {
          await client.query(UNLOCK, [threadId]);
          client.release();
        } catch (err) {
          // Destroy the connection so the session lock cannot outlive the run.
          client.release(err instanceof Error ? err : new Error(String(err)));
        }
      },
    };
  }
}
