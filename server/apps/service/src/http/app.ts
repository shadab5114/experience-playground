// HTTP door. Routes validate input, call the store port or runAgent, and
// nothing else. No agent logic lives here.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { AgentRequest } from "@experience-agent/contract";
import { runAgent, type AgentEngine, type CompositionStore, type Logger, type ThreadLock } from "@experience-agent/core";

export interface AppDeps {
  // Browser origins allowed to call the API. Requests from other origins get no CORS headers.
  corsOrigins?: string[];
  compositions: CompositionStore;
  pingDatabase: () => Promise<void>;
  // The flow that answers prompts. Built by wire(); tests pass a scripted one.
  engine: AgentEngine;
  // One run per thread: a prompt on a busy thread gets 409.
  threadLock: ThreadLock;
  log: Logger;
}

const ListQuery = z.object({
  type: z.string().trim().optional().transform((v) => v || undefined),
  q: z.string().trim().optional().transform((v) => v || undefined),
});

const ThreadId = z.string().min(1).max(128);

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  const allowedOrigins = deps.corsOrigins ?? ["http://localhost:5173"];
  app.use("/v1/*", cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : ""),
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type"],
  }));

  app.get("/health", async (c) => {
    try {
      await deps.pingDatabase();
      return c.json({ status: "ok", database: "ok" });
    } catch {
      return c.json({ status: "unavailable", database: "down" }, 503);
    }
  });

  app.get("/v1/compositions", async (c) => {
    const query = ListQuery.safeParse({ type: c.req.query("type"), q: c.req.query("q") });
    if (!query.success) return c.json({ error: "Invalid query", issues: query.error.issues }, 400);
    return c.json(await deps.compositions.list(query.data));
  });

  app.get("/v1/compositions/:compositionId", async (c) => {
    const detail = await deps.compositions.get(c.req.param("compositionId"));
    if (!detail) return c.json({ error: "Composition not found" }, 404);
    return c.json(detail);
  });

  app.get("/v1/compositions/:compositionId/placements", async (c) => {
    const compositionId = c.req.param("compositionId");
    const detail = await deps.compositions.get(compositionId);
    if (!detail) return c.json({ error: "Composition not found" }, 404);
    return c.json(await deps.compositions.placements(compositionId));
  });

  app.post("/v1/threads/:threadId/prompts", async (c) => {
    const threadId = ThreadId.safeParse(c.req.param("threadId"));
    if (!threadId.success) return c.json({ error: "Invalid thread id" }, 400);

    // Validate before any stream starts, so a bad body is a plain 400.
    const body = AgentRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "Invalid request", issues: body.error.issues }, 400);

    // The lock is taken before the stream starts, so a busy thread is a plain 409.
    let lock: Awaited<ReturnType<ThreadLock["tryAcquire"]>>;
    try {
      lock = await deps.threadLock.tryAcquire(threadId.data);
    } catch {
      deps.log.error("thread-lock-unavailable", { threadId: threadId.data });
      return c.json({ error: "The agent is busy. Try again shortly." }, 503);
    }
    if (!lock) return c.json({ error: "A prompt is already running on this thread." }, 409);
    const held = lock;

    return streamSSE(c, async (stream) => {
      try {
        const events = runAgent(body.data, {
          threadId: threadId.data,
          signal: c.req.raw.signal,
          engine: deps.engine,
          log: deps.log,
        });
        for await (const event of events) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
      } finally {
        await held.release();
      }
    });
  });

  return app;
}
