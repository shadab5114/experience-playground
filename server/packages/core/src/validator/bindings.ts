// Warnings only: a binding path that does not resolve in the document's own
// data model. Warnings never block; they go to logs and traces.
import type { Model } from "./model";
import { bindingPaths, resolvePointer } from "./model";
import type { ValidationContext, ValidationError } from "./types";

export function checkBindings(m: Model, _ctx: ValidationContext): ValidationError[] {
  const out: ValidationError[] = [];
  for (const c of m.comps) {
    // Inside a list item, paths are relative to the item, which we cannot resolve
    // without the list's data. Absolute paths there are a structure warning.
    if (c.id !== undefined && m.repeated.has(c.id)) continue;
    for (const p of bindingPaths(Object.fromEntries(Object.entries(c.raw).filter(([k]) => k !== "id" && k !== "component")))) {
      if (!resolvePointer(m.dataModel, p).found) {
        out.push({
          severity: "warning",
          layer: "bindings",
          code: "unresolved-binding",
          componentId: c.id,
          path: c.path,
          message: `component "${c.id ?? "(no id)"}" binds "${p}", which is not in the document's data model`,
        });
      }
    }
  }
  return out;
}
