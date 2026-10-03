// Layer 3: ids and references. Unique ids, every child reference resolves,
// nothing unreachable from root, and no absolute binding inside a list item.
import type { Model } from "./model";
import { bindingPaths, refsOf } from "./model";
import type { ValidationContext, ValidationError } from "./types";

export function checkStructure(m: Model, _ctx: ValidationContext): ValidationError[] {
  const out: ValidationError[] = [];
  const push = (e: Omit<ValidationError, "layer" | "severity">, severity: "error" | "warning" = "error"): void => {
    out.push({ ...e, layer: "structure", severity });
  };

  const seen = new Set<string>();
  for (const c of m.comps) {
    if (c.id === undefined) {
      push({ code: "component-no-id", path: c.path, message: "component has no string id" });
      continue;
    }
    if (seen.has(c.id)) {
      push({ code: "duplicate-id", componentId: c.id, path: c.path, message: `duplicate component id "${c.id}"` });
    }
    seen.add(c.id);
  }

  const referenced = new Set<string>();
  for (const c of m.comps) {
    const { hard, soft } = refsOf(c.raw);
    for (const ref of hard) {
      if (m.byId.has(ref)) referenced.add(ref);
      else {
        push({
          code: "dangling-reference",
          componentId: c.id,
          path: c.path,
          message: `component "${c.id ?? "(no id)"}" references missing child id "${ref}"`,
        });
      }
    }
    for (const ref of soft) if (m.byId.has(ref)) referenced.add(ref);
  }

  for (const c of m.comps) {
    if (c.id === undefined || c.id === "root") continue;
    if (!referenced.has(c.id)) {
      push({ code: "orphan", componentId: c.id, path: c.path, message: `component "${c.id}" is not reachable from root` });
    }
  }

  for (const c of m.comps) {
    if (c.id === undefined || !m.repeated.has(c.id)) continue;
    const { raw } = c;
    const ch = raw.children;
    const ownTemplatePath = typeof ch === "object" && ch !== null && !Array.isArray(ch) && "componentId" in ch;
    for (const [key, value] of Object.entries(raw)) {
      if (key === "id" || key === "component") continue;
      if (ownTemplatePath && key === "children") {
        // The list's own binding is relative to its parent; skip it here.
        const rest = { ...(ch as Record<string, unknown>) };
        delete rest.path;
        if (Object.keys(rest).length === 0) continue;
      }
      for (const p of bindingPaths(value)) {
        if (p.startsWith("/")) {
          push(
            {
              code: "absolute-path-in-template",
              componentId: c.id,
              path: c.path,
              message: `component "${c.id}" is inside a list template but binds the absolute path "${p}"; use a path relative to the item`,
            },
            "warning",
          );
        }
      }
    }
  }

  return out;
}
