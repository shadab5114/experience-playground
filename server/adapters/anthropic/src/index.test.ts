import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createAnthropicModel, ModelOutputError } from "./index";

const SECRET = "sk-ant-test-secret-value";

const Answer = z.object({ kind: z.enum(["edit", "refusal"]), summary: z.string() });

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

// A fetch stand-in that records the request and answers with the given tool input.
function fakeFetch(toolInput: unknown, captured: Captured[]): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    captured.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "test-model",
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", id: "toolu_1", name: "submit_result", input: toolInput }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

function modelWith(toolInput: unknown, captured: Captured[]) {
  return createAnthropicModel({
    baseURL: "https://gateway.example.test",
    apiKey: SECRET,
    model: "test-model",
    timeoutMs: 5_000,
    fetch: fakeFetch(toolInput, captured),
  });
}

describe("Anthropic model adapter", () => {
  test("sends the schema as a forced tool call to the configured base URL with the key", async () => {
    const captured: Captured[] = [];
    const model = modelWith({ kind: "edit", summary: "Done" }, captured);

    await model.structured({
      system: "be brief",
      messages: [{ role: "user", content: "hello" }],
      schema: Answer,
    });

    const [call] = captured;
    expect(call?.url).toBe("https://gateway.example.test/v1/messages");
    expect(call?.headers.get("x-api-key")).toBe(SECRET);
    expect(call?.body).toMatchObject({
      model: "test-model",
      system: "be brief",
      messages: [{ role: "user", content: "hello" }],
      tool_choice: { type: "tool", name: "submit_result" },
    });
    const tools = call?.body.tools as { input_schema: { type: string; $schema?: string } }[];
    expect(tools[0]?.input_schema.type).toBe("object");
    expect(tools[0]?.input_schema).not.toHaveProperty("$schema");
  });

  test("returns the parsed tool input", async () => {
    const model = modelWith({ kind: "refusal", summary: "No" }, []);
    await expect(model.structured({ system: "", messages: [], schema: Answer })).resolves.toEqual({
      kind: "refusal",
      summary: "No",
    });
  });

  test("rejects output that does not match the schema, naming the field but not the key", async () => {
    const model = modelWith({ kind: "maybe", summary: "x" }, []);
    const err = await model.structured({ system: "", messages: [], schema: Answer }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelOutputError);
    expect((err as Error).message).toContain("kind");
    expect((err as Error).message).not.toContain(SECRET);
  });

  test("fails when the model returns no tool call", async () => {
    const noTool: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "msg_2",
          type: "message",
          role: "assistant",
          model: "test-model",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "text", text: "just prose" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const model = createAnthropicModel({
      baseURL: "https://gateway.example.test",
      apiKey: SECRET,
      model: "test-model",
      timeoutMs: 5_000,
      fetch: noTool,
    });
    await expect(model.structured({ system: "", messages: [], schema: Answer })).rejects.toBeInstanceOf(ModelOutputError);
  });
});
