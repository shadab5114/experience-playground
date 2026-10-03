import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { serve } from "./node-server";

const app = new Hono();
app.get("/ping", (c) => c.json({ ok: true }));
app.post("/echo", async (c) => c.json(await c.req.json()));
app.get("/sse", (c) =>
  streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "status", data: "one" });
    await stream.writeSSE({ event: "result", data: "two" });
  }),
);

const server = serve(app, 0);
let base = "";

beforeAll(async () => {
  if (!server.listening) await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

describe("node http adapter", () => {
  test("serves a GET with a JSON body", async () => {
    const res = await fetch(`${base}/ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("passes a POST body through to the handler", async () => {
    const res = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(await res.json()).toEqual({ hello: "world" });
  });

  test("streams SSE frames as they are written", async () => {
    const res = await fetch(`${base}/sse`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: status");
    expect(text).toContain("event: result");
  });

  test("returns 404 for unknown routes", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
