// What the model returns at each structured step. Each schema is an object at
// the top level, because a tool's input schema must be one.
import { z } from "zod";
import { A2UIDocumentSchema } from "@experience-agent/contract";

export const RouteSchema = z.object({
  kind: z.enum(["edit", "ask", "scope", "unsupported", "switch"]),
  components: z.array(z.string()),
  topic: z.string().nullable(),
  message: z.string(),
  // For edits: questions the generator must have answered, e.g. "Which Badge background
  // colors are approved on a plan tile, and is red one of them?". Never the user's words.
  guidelineQueries: z.array(z.string().min(1)).max(3).default([]),
  // For switch: the composition name the designer used.
  targetText: z.string().nullable().default(null),
});

// Used only when several compositions match: the model may pick one of them, or none.
export const PickSchema = z.object({
  compositionId: z.string().nullable(),
  message: z.string(),
});

// A document from the model. Some models return a nested object as a JSON string;
// accept that, but only when the string parses into a valid document.
export const ModelDocumentSchema = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}, A2UIDocumentSchema);

// Each field below belongs to one kind, so the other kind's fields are
// routinely absent rather than null. They default instead of being required:
// an omitted field must not turn a perfectly good refusal into a failed run.
export const GenerateSchema = z.object({
  kind: z.enum(["edit", "refusal"]),
  // Set when kind is "edit".
  a2ui: ModelDocumentSchema.nullish().default(null),
  summary: z.string().nullish().default(null),
  message: z.string().nullish().default(null),
  // Set when kind is "refusal".
  reason: z.string().nullish().default(null),
  alternatives: z.array(z.string()).nullish().default([]),
});
export type GenerateOutput = z.infer<typeof GenerateSchema>;
