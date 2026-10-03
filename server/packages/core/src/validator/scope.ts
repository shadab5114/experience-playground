// Layer 5: scope. The surface, the root and the catalog must match the document
// the user currently sees. Runs only when a current document is given.
import { buildModel } from "./model";
import type { Model } from "./model";
import type { ValidationContext, ValidationError } from "./types";

export function checkScope(m: Model, ctx: ValidationContext): ValidationError[] {
  if (ctx.current === undefined) return [];
  const before = buildModel(ctx.current);
  const out: ValidationError[] = [];
  const err = (code: string, path: string, message: string): void => {
    out.push({ severity: "error", layer: "scope", code, path, message });
  };

  if (before.createSurface?.surfaceId !== m.createSurface?.surfaceId) {
    err(
      "scope-surface-id",
      "a2ui[createSurface].surfaceId",
      `surfaceId must stay ${JSON.stringify(before.createSurface?.surfaceId)}, got ${JSON.stringify(m.createSurface?.surfaceId)}`,
    );
  }
  if (before.createSurface?.catalogId !== m.createSurface?.catalogId) {
    err(
      "scope-catalog-id",
      "a2ui[createSurface].catalogId",
      `catalogId must stay ${JSON.stringify(before.createSurface?.catalogId)}, got ${JSON.stringify(m.createSurface?.catalogId)}`,
    );
  }
  const beforeRoot = before.byId.get("root")?.id;
  const afterRoot = m.byId.get("root")?.id;
  if (beforeRoot !== afterRoot) {
    err("scope-root-id", "a2ui", `root id must stay "${beforeRoot ?? ""}", got "${afterRoot ?? ""}"`);
  }

  return out;
}
