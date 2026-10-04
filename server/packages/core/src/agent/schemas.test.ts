import { describe, expect, test } from "vitest";
import { GenerateSchema, ModelDocumentSchema } from "./schemas";

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

// A refusal names reason and alternatives; an edit names a2ui, summary and
// message. A model that sends only the fields its kind needs must not fail the
// run — rules written in the Studio make refusals an ordinary outcome, and a
// crash is worse than a refusal.
describe("GenerateSchema tolerates the fields the other kind does not use", () => {
  test("a refusal with no edit fields parses", () => {
    const parsed = GenerateSchema.parse({
      kind: "refusal",
      reason: "The author's rules say the price text must not change.",
      alternatives: ["Change the eyebrow instead"],
    });
    expect(parsed.a2ui).toBeNull();
    expect(parsed.summary).toBeNull();
  });

  test("a refusal with no alternatives parses as an empty list", () => {
    expect(GenerateSchema.parse({ kind: "refusal", reason: "no" }).alternatives).toEqual([]);
  });

  test("an edit with no refusal fields parses", () => {
    const parsed = GenerateSchema.parse({
      kind: "edit",
      a2ui: { a2ui: [{ version: "v0.9", createSurface: { surfaceId: "main", catalogId: "x" } }] },
      summary: "Changed it",
      message: "Done.",
    });
    expect(parsed.reason).toBeNull();
    expect(parsed.alternatives).toEqual([]);
  });

  test("an explicit null is still accepted, as models send both", () => {
    expect(GenerateSchema.parse({ kind: "refusal", reason: "no", a2ui: null, alternatives: null }).a2ui).toBeNull();
  });
});
