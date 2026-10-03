// HTTP door. Routes validate input, call the store port or runAgent, and
// nothing else. No agent logic lives here.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { AgentRequest } from "@experience-agent/contract";
import { runAgent, type AgentEngine, type CompositionStore, type Logger } from "@experience-agent/core";

export interface AppDeps {
  // Browser origins allowed to call the API. Requests from other origins get no CORS headers.
  corsOrigins?: string[];
  compositions: CompositionStore;
  pingDatabase: () => Promise<void>;
  // The flow that answers prompts. Built by wire(); tests pass a scripted one.
  engine: AgentEngine;
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

    return streamSSE(c, async (stream) => {
      const events = runAgent(body.data, {
        threadId: threadId.data,
        signal: c.req.raw.signal,
        engine: deps.engine,
        log: deps.log,
      });
      for await (const event of events) {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    });
  });

  return app;
}
