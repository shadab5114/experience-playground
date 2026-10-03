// Layer 4: must-never rules. DS-101 to DS-105 are placeholders (see rules.json)
// until the design team supplies the real list. Cap colors come from rules.json.
import type { Model, Comp } from "./model";
import { isObj } from "./model";
import type { ValidationContext, ValidationError } from "./types";

const LABELLED = ["InputField", "TextArea", "CheckboxGroup", "RadioButtonGroup"];
const PRICE = /[$€£]\s?\d/;
const SKIP_TEXT_KEYS = new Set(["id", "component", "href", "src", "action", "checks"]);

const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

// Literal strings under a prop value. Bindings and actions are skipped.
function literalStrings(value: unknown, key = "", out: { key: string; text: string }[] = []): { key: string; text: string }[] {
  if (SKIP_TEXT_KEYS.has(key)) return out;
  if (typeof value === "string") out.push({ key, text: value });
  else if (isObj(value)) {
    if (typeof value.path === "string" && Object.keys(value).every((k) => k === "path")) return out;
    for (const [k, v] of Object.entries(value)) literalStrings(v, k, out);
  } else if (Array.isArray(value)) {
    for (const v of value) literalStrings(v, key, out);
  }
  return out;
}

export function checkRules(m: Model, ctx: ValidationContext): ValidationError[] {
  const out: ValidationError[] = [];
  const caps = new Set(ctx.catalog.rules().capColors);
  const err = (c: Comp, code: string, message: string): void => {
    out.push({ severity: "error", layer: "rules", code, componentId: c.id, path: c.path, message });
  };

  // DS-101: one primary button per surface; none inside a list item.
  const primaries = m.comps.filter((c) => c.component === "Button" && (c.raw.kind ?? "primary") === "primary");
  for (const c of primaries) {
    if (c.id !== undefined && m.repeated.has(c.id)) {
      err(c, "DS-101", "a primary button inside a repeated list item renders once per item");
    }
  }
  if (primaries.length > 1) {
    for (const c of primaries) err(c, "DS-101", `${primaries.length} primary buttons on one surface; only one is allowed`);
  }

  for (const c of m.comps) {
    if (c.component === undefined) continue;

    // DS-102: inputs need a visible label.
    if (LABELLED.includes(c.component) && isBlank(c.raw.label)) {
      err(c, "DS-102", `${c.component} has no label`);
    }

    // DS-103: badges are short. Badge only.
    if (c.component === "Badge" && typeof c.raw.children === "string") {
      const text = c.raw.children;
      if (text.length > 24 || text.trim().split(/\s+/).length > 3) {
        err(c, "DS-103", `badge text "${text}" is too long (at most 3 words and 24 characters)`);
      }
    }

    // DS-104: images have alt text.
    if (c.component === "Image" && isBlank(c.raw.alt)) {
      err(c, "DS-104", "Image has no alt text");
    }

    // DS-105: prices come from data, never literal text.
    for (const s of literalStrings(Object.fromEntries(Object.entries(c.raw).filter(([k]) => !SKIP_TEXT_KEYS.has(k))))) {
      if (PRICE.test(s.text)) err(c, "DS-105", `literal price in ${s.key || "text"}: "${s.text}"; bind it to the data model instead`);
    }

    // Cap colors: Badge background must be an approved token.
    if (c.component === "Badge" && typeof c.raw.backgroundColor === "string" && !caps.has(c.raw.backgroundColor)) {
      err(c, "cap-color-not-approved", `badge background "${c.raw.backgroundColor}" is not an approved cap color`);
    }
  }

  return out;
}
