// Layer 1: the document's envelope. Pinned A2UI version, message kinds,
// exactly one root, and the catalog id the surface declares.
import type { Model } from "./model";
import { isObj } from "./model";
import type { ValidationContext, ValidationError } from "./types";

const MESSAGE_KINDS = ["createSurface", "updateDataModel", "updateComponents", "deleteSurface"];

export function checkEnvelope(m: Model, ctx: ValidationContext): ValidationError[] {
  const out: ValidationError[] = [];
  const err = (code: string, path: string, message: string, componentId?: string): void => {
    out.push({
      severity: "error",
      layer: "envelope",
      code,
      path,
      message,
      ...(componentId !== undefined ? { componentId } : {}),
    });
  };

  // Message shape: version and exactly one known kind.
  for (const msg of m.messageList) {
    if (!isObj(msg.value)) {
      err("bad-message", msg.path, "message is not an object");
      continue;
    }
    if (msg.value.version !== "v0.9") {
      err("bad-version", msg.path, `version must be "v0.9", got ${JSON.stringify(msg.value.version)}`);
    }
    const value = msg.value;
    const kinds = MESSAGE_KINDS.filter((k) => isObj(value[k]));
    if (kinds.length !== 1) {
      err("bad-message-kind", msg.path, `a message needs exactly one of ${MESSAGE_KINDS.join(", ")}`);
    }
  }

  if (m.createSurface === undefined) {
    err("no-surface", "a2ui", "the document has no createSurface message");
  } else if (m.createSurface.catalogId !== ctx.catalog.catalogId) {
    err(
      "catalog-id-mismatch",
      "a2ui[createSurface].catalogId",
      `catalogId must be ${ctx.catalog.catalogId}, got ${JSON.stringify(m.createSurface.catalogId)}`,
    );
  }

  if (m.comps.length === 0) {
    err("no-components", "a2ui", "no updateComponents message has any components");
    return out;
  }

  const roots = m.comps.filter((c) => c.id === "root");
  if (roots.length === 0) err("missing-root", "a2ui", 'no component has id "root"');
  if (roots.length > 1) err("duplicate-root", roots[1]!.path, 'more than one component has id "root"', "root");

  return out;
}
