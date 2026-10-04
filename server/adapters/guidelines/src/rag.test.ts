import { describe, expect, test } from "vitest";
import { createRagGuidelineSource, RagError } from "./index";

interface Captured {
  url: string;
  headers: Headers;
  body: { query: string; collection_name: string };
}

// A fetch stand-in that records the request and answers with the given response.
function fakeFetch(respond: () => Response, captured: Captured[]): typeof globalThis.fetch {
  return async (input, init) => {
    captured.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return respond();
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function source(respond: () => Response, captured: Captured[] = [], apiKey?: string) {
  return createRagGuidelineSource({
    baseUrl: "http://localhost:8080/",
    collection: "vds-guidelines",
    timeoutMs: 5_000,
    ...(apiKey ? { apiKey } : {}),
    fetch: fakeFetch(respond, captured),
  });
}

describe("RAG guideline source", () => {
  test("posts the query and collection to /query and returns the answer as a passage", async () => {
    const captured: Captured[] = [];
    const rag = source(() => json({ answer: "Use surface tokens.", latency_ms: 42 }), captured);

    const question = "Which background tokens are approved for a TileContainer, and is red one of them?";
    const hits = await rag.search({ query: question, components: ["TileContainer"] });

    expect(captured[0]?.url).toBe("http://localhost:8080/query");
    expect(captured[0]?.body).toEqual({ query: question, collection_name: "vds-guidelines" });
    expect(hits).toEqual([{ sourceId: expect.stringMatching(/^rag-[0-9a-f]{12}$/), text: "Use surface tokens." }]);
  });

  test("the same query gets the same internal source id", async () => {
    const a = await source(() => json({ answer: "x" })).search({ query: "Is red approved?", components: ["Badge"] });
    const b = await source(() => json({ answer: "y" })).search({ query: "Is red approved?", components: ["Badge"] });
    expect(a[0]?.sourceId).toBe(b[0]?.sourceId);
  });

  test("sends the bearer key only when one is set", async () => {
    const withKey: Captured[] = [];
    await source(() => json({ answer: "x" }), withKey, "rag-secret").search({ query: "q", components: [] });
    expect(withKey[0]?.headers.get("authorization")).toBe("Bearer rag-secret");

    const without: Captured[] = [];
    await source(() => json({ answer: "x" }), without).search({ query: "q", components: [] });
    expect(without[0]?.headers.get("authorization")).toBeNull();
  });

  test("an empty answer means no guidance, not an error", async () => {
    expect(await source(() => json({ answer: "  " })).search({ query: "q", components: [] })).toEqual([]);
  });

  test("a non-200 response is a RagError with the status", async () => {
    const err = await source(() => json({ error: "boom" }, 503)).search({ query: "q", components: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RagError);
    expect((err as Error).message).toContain("503");
  });

  test("an answer in the wrong shape is a RagError", async () => {
    const err = await source(() => json({ text: "wrong key" })).search({ query: "q", components: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RagError);
  });

  test("a network failure is a RagError and does not leak the underlying message", async () => {
    const rag = createRagGuidelineSource({
      baseUrl: "http://localhost:8080",
      collection: "vds-guidelines",
      timeoutMs: 5_000,
      fetch: async () => {
        throw new TypeError("connect ECONNREFUSED 127.0.0.1:8080 rag-secret");
      },
    });
    const err = await rag.search({ query: "q", components: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RagError);
    expect((err as Error).message).not.toContain("rag-secret");
  });

});
