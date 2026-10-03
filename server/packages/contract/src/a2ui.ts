// A2UI v0.9 wire types, shared by the playground and the backend.
// These interfaces are the spec. Each one has a Zod schema below; the
// `z.ZodType<T>` annotations make the compiler check that schema and type agree.
//
// Typing is deliberately loose below the component level: a component needs
// `id` and `component`, and any other prop is allowed. Prop rules belong to
// the validator and the catalog, not to this contract.
import { z } from "zod";

export interface A2UIComponentNode {
  id: string;
  /** Catalog component name, e.g. "Stack", "Text", "Badge". */
  component: string;
  [prop: string]: unknown;
}

export interface A2UICreateSurfaceMessage {
  version: "v0.9";
  createSurface: { surfaceId: string; catalogId: string };
}

export interface A2UIUpdateDataModelMessage {
  version: "v0.9";
  updateDataModel: { surfaceId: string; path: string; value: unknown };
}

export interface A2UIUpdateComponentsMessage {
  version: "v0.9";
  updateComponents: { surfaceId: string; components: A2UIComponentNode[] };
}

export interface A2UIDeleteSurfaceMessage {
  version: "v0.9";
  deleteSurface: { surfaceId: string };
}

export type A2UIMessage =
  | A2UICreateSurfaceMessage
  | A2UIUpdateDataModelMessage
  | A2UIUpdateComponentsMessage
  | A2UIDeleteSurfaceMessage;

export interface A2UIMeta {
  provider?: string;
  model?: string;
  catalogId: string;
  /** Catalog component names used in this document, for debugging and review. */
  components?: string[];
  generatedAt?: string;
}

/** The app's own header plus the ordered A2UI message log. */
export interface A2UIDocument {
  meta?: A2UIMeta;
  a2ui: A2UIMessage[];
}

/** A bindable string: a literal, or `{ path }` resolved against the current binding context. */
export type DynamicString = string | { path: string };

// ---- Zod schemas (runtime checks for the same shapes) ----

export const A2UIComponentNodeSchema: z.ZodType<A2UIComponentNode> = z.looseObject({
  id: z.string(),
  component: z.string(),
});

const CreateSurfaceSchema: z.ZodType<A2UICreateSurfaceMessage> = z.object({
  version: z.literal("v0.9"),
  createSurface: z.object({ surfaceId: z.string(), catalogId: z.string() }),
});

const UpdateDataModelSchema: z.ZodType<A2UIUpdateDataModelMessage> = z.object({
  version: z.literal("v0.9"),
  updateDataModel: z.object({ surfaceId: z.string(), path: z.string(), value: z.unknown() }),
});

const UpdateComponentsSchema: z.ZodType<A2UIUpdateComponentsMessage> = z.object({
  version: z.literal("v0.9"),
  updateComponents: z.object({
    surfaceId: z.string(),
    components: z.array(A2UIComponentNodeSchema),
  }),
});

const DeleteSurfaceSchema: z.ZodType<A2UIDeleteSurfaceMessage> = z.object({
  version: z.literal("v0.9"),
  deleteSurface: z.object({ surfaceId: z.string() }),
});

export const A2UIMessageSchema: z.ZodType<A2UIMessage> = z.union([
  CreateSurfaceSchema,
  UpdateDataModelSchema,
  UpdateComponentsSchema,
  DeleteSurfaceSchema,
]);

export const A2UIMetaSchema: z.ZodType<A2UIMeta> = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  catalogId: z.string(),
  components: z.array(z.string()).optional(),
  generatedAt: z.string().optional(),
});

export const A2UIDocumentSchema: z.ZodType<A2UIDocument> = z.object({
  meta: A2UIMetaSchema.optional(),
  a2ui: z.array(A2UIMessageSchema).min(1),
});
