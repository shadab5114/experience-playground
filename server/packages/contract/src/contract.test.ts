import { describe, expect, test } from "vitest";
import { A2UIDocumentSchema, AgentEvent, AgentRequest } from "./index";

const validDoc = {
  meta: {
    provider: "mock",
    model: "fixture",
    catalogId: "https://pdesign.dev/catalog/v1/catalog.json",
    components: ["TileContainer"],
    generatedAt: "2026-10-01T00:00:00.000Z",
  },
  a2ui: [{ version: "v0.9", createSurface: { surfaceId: "main", catalogId: "x" } }],
};

describe("contract schemas", () => {
  test("A2UIDocument accepts a v0.9 envelope", () => {
    expect(A2UIDocumentSchema.safeParse(validDoc).success).toBe(true);
  });

  test("A2UIDocument accepts a document without meta", () => {
    expect(A2UIDocumentSchema.safeParse({ a2ui: validDoc.a2ui }).success).toBe(true);
  });

  test("A2UIDocument rejects a non-v0.9 message", () => {
    const bad = { ...validDoc, a2ui: [{ version: "v1.0" }] };
    expect(A2UIDocumentSchema.safeParse(bad).success).toBe(false);
  });

  test("a component needs id and component, but any other prop is allowed", () => {
    const withProps = {
      a2ui: [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "main",
            components: [{ id: "badge", component: "Badge", size: "anything", backgroundColor: "red" }],
          },
        },
      ],
    };
    expect(A2UIDocumentSchema.safeParse(withProps).success).toBe(true);
    const noId = { a2ui: [{ version: "v0.9", updateComponents: { surfaceId: "main", components: [{ component: "Badge" }] } }] };
    expect(A2UIDocumentSchema.safeParse(noId).success).toBe(false);
  });

  test("AgentRequest requires a prompt and a composition, and has no threadId", () => {
    expect(AgentRequest.safeParse({ experienceId: "e", compositionId: "c", currentA2ui: validDoc }).success).toBe(false);
    const parsed = AgentRequest.parse({ experienceId: "e", compositionId: "c", currentA2ui: validDoc, prompt: "hi" });
    expect("threadId" in parsed).toBe(false);
  });

  test("AgentEvent rejects an unknown event type", () => {
    expect(AgentEvent.safeParse({ type: "patch", a2ui: validDoc }).success).toBe(false);
  });
});
