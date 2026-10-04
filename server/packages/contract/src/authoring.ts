// Writable shapes for the Studio (authoring UI). The read projections above
// (CompositionSummary, CompositionDetail, PlacementView) stay as they are;
// these are what a caller sends when it creates or edits content, and what it
// gets back afterwards.
//
// Input vs. Record: an Input carries only what a person writes. Everything the
// server owns or derives — components_used, a2ui_version, a page's slots,
// origin, updated_at — appears on the Record only, never on the Input.
import { z } from "zod";
import { A2UIDocumentSchema } from "./a2ui";

// Record ids become part of A2UI surface ids ("page:<id>", "slot:<pageId>:<slotId>"),
// so they may not contain a colon, whitespace or anything else that would make
// that convention ambiguous.
export const RecordId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "use lowercase letters, digits, '-' and '_'; must start with a letter or digit");
export type RecordId = z.infer<typeof RecordId>;

// Where a record came from. 'sample' = inserted by the pack's sample importer,
// so re-importing samples can restore it after a delete. 'authored' = written
// here, and gone for good once deleted. An edit does not change a row's origin:
// it records where the row came from, not whether anyone has touched it since.
export const RecordOrigin = z.enum(["sample", "authored"]);
export type RecordOrigin = z.infer<typeof RecordOrigin>;

// Who saved a version. "studio" = a person authored it directly; "agent" = it
// came out of an agent edit the designer then saved. Real identities wait for auth.
export const SavedBy = z.enum(["studio", "agent"]);
export type SavedBy = z.infer<typeof SavedBy>;

export const CompositionInput = z.object({
  compositionId: RecordId,
  name: z.string().min(1),
  family: z.string().min(1),
  // Read by the agent when it picks which composition a prompt is about.
  description: z.string().min(1),
  // Free-text guidance injected into the agent's prompt when it edits this
  // composition. Steers the model; it is not enforced by the validator.
  agentRules: z.string().optional(),
  type: z.string().min(1),
  tags: z.array(z.string().min(1)),
  a2ui: A2UIDocumentSchema,
});
export type CompositionInput = z.infer<typeof CompositionInput>;

export const CompositionRecord = CompositionInput.extend({
  // Derived from the document's updateComponents messages, never from meta.components.
  componentsUsed: z.array(z.string()),
  a2uiVersion: z.string().min(1),
  origin: RecordOrigin,
  updatedAt: z.string().datetime(),
});
export type CompositionRecord = z.infer<typeof CompositionRecord>;

export const PageTemplateInput = z.object({
  pageTemplateId: RecordId,
  flowId: RecordId,
  name: z.string().min(1),
  description: z.string().optional(),
  agentRules: z.string().optional(),
  a2ui: A2UIDocumentSchema,
});
export type PageTemplateInput = z.infer<typeof PageTemplateInput>;

export const PageTemplateRecord = PageTemplateInput.extend({
  // Derived from the document's Slot nodes, so a page's slots can never drift
  // from what it actually declares.
  slots: z.array(z.string()),
  origin: RecordOrigin,
});
export type PageTemplateRecord = z.infer<typeof PageTemplateRecord>;

export const FlowInput = z.object({
  flowId: RecordId,
  name: z.string().min(1),
});
export type FlowInput = z.infer<typeof FlowInput>;

// A flow has no derived or server-owned fields, so its record is its input.
export const FlowRecord = FlowInput;
export type FlowRecord = z.infer<typeof FlowRecord>;

// One composition hosted in one slot of one page. Unlike PlacementView (a read
// projection for the Impacts view) this is the row itself: it names the
// composition and carries the tab order.
export const PlacementInput = z.object({
  compositionId: RecordId,
  pageTemplateId: RecordId,
  slotId: RecordId,
  variant: z.string().min(1).optional(),
  position: z.number().int().min(0),
});
export type PlacementInput = z.infer<typeof PlacementInput>;

// Placements have no server-owned fields either; the primary key is all three ids.
export const PlacementRecord = PlacementInput;
export type PlacementRecord = z.infer<typeof PlacementRecord>;

export const PlacementKey = PlacementInput.pick({
  compositionId: true,
  pageTemplateId: true,
  slotId: true,
});
export type PlacementKey = z.infer<typeof PlacementKey>;

// What a saved version looks like in the history panel. The document itself is
// not included: the panel lists versions, it does not render them.
export const CompositionVersionSummary = z.object({
  version: z.number().int().min(1),
  summary: z.string().optional(),
  // Free-form on read even though writes go through SavedBy, so rows written by
  // a future authenticated caller still parse.
  savedBy: z.string().optional(),
  savedAt: z.string().datetime(),
});
export type CompositionVersionSummary = z.infer<typeof CompositionVersionSummary>;

// What a hard delete takes with it. The confirm dialog names these counts before
// the click, because cascading away saved versions cannot be undone.
export const DeleteImpact = z.object({
  origin: RecordOrigin,
  placements: z.number().int().min(0),
  savedVersions: z.number().int().min(0),
});
export type DeleteImpact = z.infer<typeof DeleteImpact>;

// A validation finding, shaped to match the core validator's ValidationError.
// Defined here rather than imported because the contract may not depend on the
// core; a type-level check in the core keeps the two from drifting.
export const ValidationFinding = z.object({
  severity: z.enum(["error", "warning"]),
  layer: z.enum(["envelope", "catalog", "structure", "bindings", "rules", "scope"]),
  code: z.string(),
  componentId: z.string().optional(),
  path: z.string(),
  message: z.string(),
  hint: z.string().optional(),
});
export type ValidationFinding = z.infer<typeof ValidationFinding>;

export const ValidationReport = z.object({
  errors: z.array(ValidationFinding),
  warnings: z.array(ValidationFinding),
});
export type ValidationReport = z.infer<typeof ValidationReport>;
