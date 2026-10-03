// validate(doc, context) runs every layer and returns all findings.
// Errors block the draft and go to repair. Warnings go to logs and traces only.
import { buildModel } from "./model";
import { checkEnvelope } from "./envelope";
import { checkCatalog } from "./catalog";
import { checkStructure } from "./structure";
import { checkBindings } from "./bindings";
import { checkRules } from "./rules";
import { checkScope } from "./scope";
import type { ValidationContext, ValidationError } from "./types";

export type { DocumentKind, ValidationContext, ValidationError } from "./types";

export function validate(doc: unknown, ctx: ValidationContext): ValidationError[] {
  const model = buildModel(doc);
  return [
    ...checkEnvelope(model, ctx),
    ...checkCatalog(model, ctx),
    ...checkStructure(model, ctx),
    ...checkBindings(model, ctx),
    ...checkRules(model, ctx),
    ...checkScope(model, ctx),
  ];
}

export const blocking = (findings: ValidationError[]): ValidationError[] =>
  findings.filter((f) => f.severity === "error");

export const warnings = (findings: ValidationError[]): ValidationError[] =>
  findings.filter((f) => f.severity === "warning");
