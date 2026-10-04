import { describe, expect, test } from "vitest";
import {
  CompositionInput,
  CompositionRecord,
  DeleteImpact,
  PlacementInput,
  PlacementKey,
  RecordId,
  SavedBy,
} from "./index";

const doc = {
  a2ui: [{ version: "v0.9", createSurface: { surfaceId: "main", catalogId: "x" } }],
};

const input = {
  compositionId: "basic-plan-tile",
  name: "Basic Plan – Mobile",
  family: "Basic Plan Tile",
  description: "Mobile version of the basic plan.",
  type: "plan-tile",
  tags: ["plan", "mobile"],
  a2ui: doc,
};

describe("RecordId", () => {
  test("accepts the ids the samples already use", () => {
    for (const id of ["basic-plan-tile", "pdp-mock", "plan-summary", "order_summary", "v2"]) {
      expect({ id, ok: RecordId.safeParse(id).success }).toEqual({ id, ok: true });
    }
  });

  test("rejects anything that would make a surface id ambiguous", () => {
    // "page:<id>" and "slot:<pageId>:<slotId>" are parsed by splitting on ":".
    for (const id of ["page:pdp", "has space", "Caps", "-leading-dash", "", "a".repeat(65)]) {
      expect({ id, ok: RecordId.safeParse(id).success }).toEqual({ id, ok: false });
    }
  });
});

describe("CompositionInput", () => {
  test("accepts what a person writes", () => {
    expect(CompositionInput.safeParse(input).success).toBe(true);
    expect(CompositionInput.safeParse({ ...input, agentRules: "Never change the price." }).success).toBe(true);
  });

  test("requires the prose the agent reads", () => {
    expect(CompositionInput.safeParse({ ...input, description: "" }).success).toBe(false);
    expect(CompositionInput.safeParse({ ...input, family: "" }).success).toBe(false);
  });

  test("drops server-owned fields instead of letting a caller set them", () => {
    const parsed = CompositionInput.parse({ ...input, origin: "sample", componentsUsed: ["Nonsense"] });
    expect("origin" in parsed).toBe(false);
    expect("componentsUsed" in parsed).toBe(false);
  });
});

describe("CompositionRecord", () => {
  test("carries the derived and server-owned fields an input does not", () => {
    const record = {
      ...input,
      componentsUsed: ["TileContainer"],
      a2uiVersion: "v0.9",
      origin: "sample",
      updatedAt: "2026-10-04T09:30:00.000Z",
    };
    expect(CompositionRecord.safeParse(record).success).toBe(true);
    expect(CompositionRecord.safeParse({ ...record, origin: "imported" }).success).toBe(false);
    expect(CompositionRecord.safeParse({ ...record, updatedAt: "yesterday" }).success).toBe(false);
  });
});

describe("placements", () => {
  test("a placement needs its three ids and a position", () => {
    const placement = {
      compositionId: "basic-plan-tile",
      pageTemplateId: "pdp-mock",
      slotId: "plan-summary",
      position: 0,
    };
    expect(PlacementInput.safeParse(placement).success).toBe(true);
    expect(PlacementInput.safeParse({ ...placement, position: -1 }).success).toBe(false);
    expect(PlacementKey.parse({ ...placement, variant: "compact" })).toEqual({
      compositionId: "basic-plan-tile",
      pageTemplateId: "pdp-mock",
      slotId: "plan-summary",
    });
  });
});

describe("the decided enums", () => {
  test("a version is saved by the studio or by the agent, and nothing else", () => {
    expect(SavedBy.safeParse("studio").success).toBe(true);
    expect(SavedBy.safeParse("agent").success).toBe(true);
    expect(SavedBy.safeParse("someone").success).toBe(false);
  });

  test("a delete impact is three counted facts", () => {
    expect(DeleteImpact.parse({ origin: "sample", placements: 3, savedVersions: 7 })).toEqual({
      origin: "sample",
      placements: 3,
      savedVersions: 7,
    });
  });
});
