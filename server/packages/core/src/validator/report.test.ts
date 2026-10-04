// Keeps the contract's ValidationFinding and the validator's ValidationError from
// drifting. The contract may not import the core, so the shapes are declared
// twice on purpose; this is the only thing holding them together.
import { describe, expect, test } from "vitest";
import { ValidationFinding, ValidationReport } from "@experience-agent/contract";
import { blocking, warnings } from "./index";
import type { ValidationError } from "./types";

// Compile-time: every ValidationError is a valid ValidationFinding and the
// layer/severity unions match exactly. Widening either one breaks the build here.
const _finding: ValidationFinding = {} as ValidationError;
const _error: ValidationError = {} as ValidationFinding;

const findings: ValidationError[] = [
  {
    severity: "error",
    layer: "rules",
    code: "DS-103",
    componentId: "badge",
    path: "/components/badge/children",
    message: "Badge text is longer than 24 characters",
    hint: "Shorten the label",
  },
  { severity: "warning", layer: "bindings", code: "unresolved-binding", path: "/components/subtitle", message: "no data at /plan/pric" },
];

describe("validation findings cross the wire unchanged", () => {
  test("a finding from every layer parses as the contract's ValidationFinding", () => {
    const layers: ValidationError["layer"][] = ["envelope", "catalog", "structure", "bindings", "rules", "scope"];
    for (const layer of layers) {
      const one: ValidationError = { severity: "error", layer, code: "X", path: "/", message: "m" };
      expect({ layer, ok: ValidationFinding.safeParse(one).success }).toEqual({ layer, ok: true });
    }
  });

  test("blocking and warnings split into a ValidationReport", () => {
    const report = { errors: blocking(findings), warnings: warnings(findings) };
    expect(ValidationReport.parse(report)).toEqual(report);
    expect([report.errors.length, report.warnings.length]).toEqual([1, 1]);
  });
});
