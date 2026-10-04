import { describe, expect, test } from "vitest";
import { AgentRequest } from "./index";

const doc = { a2ui: [{ version: "v0.9" as const, createSurface: { surfaceId: "main", catalogId: "x" } }] };

describe("AgentRequest composition fields", () => {
  test("a prompt alone is a valid chat-first start", () => {
    expect(AgentRequest.safeParse({ prompt: "show me home plan" }).success).toBe(true);
  });

  test("a request with a composition and its document is valid", () => {
    expect(AgentRequest.safeParse({ experienceId: "e", compositionId: "c", currentA2ui: doc, prompt: "p" }).success).toBe(true);
  });

  test("a composition without its document is rejected", () => {
    expect(AgentRequest.safeParse({ compositionId: "c", prompt: "p" }).success).toBe(false);
  });

  test("a document without a composition is rejected", () => {
    expect(AgentRequest.safeParse({ currentA2ui: doc, prompt: "p" }).success).toBe(false);
  });

  test("an experience without a composition is rejected", () => {
    expect(AgentRequest.safeParse({ experienceId: "e", prompt: "p" }).success).toBe(false);
  });
});
