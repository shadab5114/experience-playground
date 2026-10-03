// Layer 2: components. Each one must be in the catalog or registered as an
// extra, allowed in this kind of document, and its props must match the schema.
import type { z } from "zod";
import type { Model } from "./model";
import type { ValidationContext, ValidationError } from "./types";

// Keys every component may carry besides its props: id/component are the
// envelope of the component, the rest are common catalog keys.
const COMMON_KEYS = new Set(["id", "component", "action", "checks", "weight"]);

type Issue = z.core.$ZodIssue;

const quote = (v: unknown): string => JSON.stringify(v);

function typeName(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v;
}

// Walks a Zod issue path (e.g. ["children", "path"]) into the raw props.
function valueAt(props: Record<string, unknown>, path: PropertyKey[]): unknown {
  let cur: unknown = props;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

// What a union's branches would accept at their own level: literal values,
// base types, or "object" for a branch that checks keys inside it.
function allowedAt(issues: Issue[]): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    if (issue.code === "invalid_union") out.push(...allowedAt(issue.errors.flat()));
    else if (issue.code === "invalid_value") out.push(...issue.values.map(quote));
    else if (issue.code === "invalid_type" && issue.path.length === 0) out.push(issue.expected);
    else if (issue.path.length > 0) out.push("object");
  }
  return [...new Set(out)];
}

// Plain sentence for one prop-level Zod issue, plus the allowed values when known.
function describeProp(
  issue: Issue,
  props: Record<string, unknown>,
  component: string,
  shape: string[],
): { message: string; hint?: string } {
  if (issue.path.length === 0) {
    // The props object as a whole failed, so no single prop is named. List the ones it takes.
    return {
      message: `${component}: ${issue.message}`,
      hint: `allowed props: ${shape.join(", ")}`,
    };
  }

  const prop = issue.path.join(".");
  const got = valueAt(props, issue.path);

  switch (issue.code) {
    case "invalid_value":
      return {
        message: `${component} prop "${prop}" is ${quote(got)}, which is not allowed`,
        hint: `allowed: ${issue.values.map(quote).join(", ")}`,
      };
    case "invalid_union": {
      const allowed = allowedAt(issue.errors.flat());
      return {
        message: `${component} prop "${prop}" has the wrong shape, got ${typeName(got)}`,
        ...(allowed.length > 0 ? { hint: `allowed: ${allowed.join(", ")}` } : {}),
      };
    }
    case "invalid_type":
      if (got === undefined) return { message: `${component} prop "${prop}" is required` };
      return { message: `${component} prop "${prop}" must be ${issue.expected}, got ${typeName(got)}` };
    default:
      return { message: `${component} prop "${prop}": ${issue.message}` };
  }
}

export function checkCatalog(m: Model, ctx: ValidationContext): ValidationError[] {
  const out: ValidationError[] = [];
  const err = (code: string, path: string, message: string, componentId?: string, hint?: string): void => {
    out.push({
      severity: "error",
      layer: "catalog",
      code,
      path,
      message,
      ...(componentId !== undefined ? { componentId } : {}),
      ...(hint !== undefined ? { hint } : {}),
    });
  };

  for (const c of m.comps) {
    if (c.component === undefined) {
      err("missing-component-name", c.path, "component has no string name", c.id);
      continue;
    }

    const entry = ctx.catalog.entry(c.component);
    if (!entry) {
      err(
        "unknown-component",
        c.path,
        `"${c.component}" is not in the design system catalog and is not a registered extra`,
        c.id,
      );
      continue;
    }

    if (entry.allowedIn !== "both" && entry.allowedIn !== ctx.kind) {
      err(
        "not-allowed-in-kind",
        c.path,
        `"${c.component}" is only allowed in ${entry.allowedIn}s, not in a ${ctx.kind}`,
        c.id,
      );
    }

    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c.raw)) if (!COMMON_KEYS.has(k)) props[k] = v;

    const result = entry.props.strict().safeParse(props);
    if (result.success) continue;

    const shape = Object.keys(entry.props.shape);
    for (const issue of result.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const key of issue.keys) {
          err("prop-undeclared", `${c.path}.${key}`, `prop "${key}" is not declared by ${c.component}`, c.id);
        }
      } else {
        const where = issue.path.length > 0 ? `${c.path}.${issue.path.join(".")}` : c.path;
        const { message, hint } = describeProp(issue, props, c.component, shape);
        err("prop-invalid", where, message, c.id, hint);
      }
    }
  }

  return out;
}
