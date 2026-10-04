import { describe, expect, test } from "vitest";
import { ModelDocumentSchema } from "./schemas";

const doc = {
  a2ui: [{ version: "v0.9", createSurface: { surfaceId: "main", catalogId: "x" } }],
};

describe("ModelDocumentSchema", () => {
  test("accepts a document as an object", () => {
    expect(ModelDocumentSchema.safeParse(doc).success).toBe(true);
  });

  test("accepts a document the model sent as a JSON string", () => {
    expect(ModelDocumentSchema.safeParse(JSON.stringify(doc)).success).toBe(true);
  });

  test("still rejects a string that is not a document", () => {
    expect(ModelDocumentSchema.safeParse("not a document").success).toBe(false);
  });
});
