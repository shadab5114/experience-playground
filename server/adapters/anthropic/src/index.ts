// The only model adapter. Implements the ModelClient port with the Anthropic
// Messages API. Structured output is a single forced tool call whose input
// schema is the Zod schema turned into JSON Schema. The base URL and key are
// passed explicitly, and neither is ever logged.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ModelClient } from "@experience-agent/core";

const TOOL_NAME = "submit_result";

export interface AnthropicModelOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  // Needed when the API key is not scoped to a workspace. Sent as a header only when set.
  workspaceId?: string;
  // Injected by tests; defaults to the global fetch.
  fetch?: typeof globalThis.fetch;
}

// The model answered, but not in the shape the schema asks for.
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelOutputError";
  }
}

const MAX_TOKENS = 8192;

export function createAnthropicModel(options: AnthropicModelOptions): ModelClient {
  const client = new Anthropic({
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    maxRetries: 2,
    ...(options.workspaceId ? { defaultHeaders: { "anthropic-workspace-id": options.workspaceId } } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    async structured({ system, messages, schema, signal }) {
      const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
      const { $schema: _dropped, ...inputSchema } = jsonSchema;

      const response = await client.messages.create(
        {
          model: options.model,
          max_tokens: MAX_TOKENS,
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          tools: [
            {
              name: TOOL_NAME,
              description: "Return the result of this step.",
              input_schema: inputSchema as Anthropic.Tool.InputSchema,
            },
          ],
          tool_choice: { type: "tool", name: TOOL_NAME },
        },
        { signal },
      );

      const block = response.content.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
      if (!block || block.type !== "tool_use") {
        throw new ModelOutputError("the model returned no structured result");
      }

      const parsed = schema.safeParse(block.input);
      if (!parsed.success) {
        const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        throw new ModelOutputError(`the model result did not match the schema: ${problems}`);
      }
      return parsed.data;
    },
  };
}
