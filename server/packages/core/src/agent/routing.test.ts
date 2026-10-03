import { describe, expect, test } from "vitest";
import { afterGather, afterGenerate, afterRoute, afterValidate, MAX_REPAIR_ATTEMPTS } from "./routing";
import { startRun, type AgentState, type Route } from "./state";
import type { ValidationError } from "../validator";

const request = { experienceId: "e", compositionId: "c", currentA2ui: { a2ui: [] }, prompt: "p" };

const route = (kind: Route["kind"]): Route => ({ kind, components: [], topic: null, message: "" });
const withState = (patch: Partial<AgentState>): AgentState => ({ ...startRun(request), ...patch });
const error: ValidationError = { severity: "error", layer: "catalog", code: "prop-invalid", path: "x", message: "m" };

describe("routing edges", () => {
  test("only edits and questions go on to gather", () => {
    expect(afterRoute(withState({ route: route("edit") }))).toBe("gather");
    expect(afterRoute(withState({ route: route("ask") }))).toBe("gather");
    expect(afterRoute(withState({ route: route("scope") }))).toBe("respond");
    expect(afterRoute(withState({ route: route("unsupported") }))).toBe("respond");
  });

  test("a question skips generate", () => {
    expect(afterGather(withState({ route: route("ask") }))).toBe("respond");
    expect(afterGather(withState({ route: route("edit") }))).toBe("generate");
  });

  test("a refusal skips validate", () => {
    expect(afterGenerate(withState({ refusal: { reason: "no", alternatives: [] } }))).toBe("respond");
    expect(afterGenerate(withState({}))).toBe("validate");
  });

  test("errors go to repair until the limit, then the run ends", () => {
    expect(afterValidate(withState({ validationErrors: [], repairAttempts: 0 }))).toBe("respond");
    expect(afterValidate(withState({ validationErrors: [error], repairAttempts: 0 }))).toBe("repair");
    expect(afterValidate(withState({ validationErrors: [error], repairAttempts: MAX_REPAIR_ATTEMPTS - 1 }))).toBe("repair");
    expect(afterValidate(withState({ validationErrors: [error], repairAttempts: MAX_REPAIR_ATTEMPTS }))).toBe("respond");
  });

  test("the repair limit is two", () => {
    expect(MAX_REPAIR_ATTEMPTS).toBe(2);
  });
});
