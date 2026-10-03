// Runs a Hono app on Node's built-in http server. Uses only Node and Web
// standard APIs (Request, Response, ReadableStream), so the service does not
// depend on Bun. Client disconnects abort the signal, which cancels the run.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Hono } from "hono";

function toRequest(req: IncomingMessage, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  return new Request(url, {
    method,
    headers,
    signal,
    ...(hasBody
      ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" as const }
      : {}),
  });
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

export function serve(app: Hono, port: number): ReturnType<typeof createServer> {
  const server = createServer(async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    try {
      await writeResponse(res, await app.fetch(toRequest(req, controller.signal)));
    } catch (err) {
      console.error("request failed:", err);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  });
  server.listen(port);
  return server;
}
