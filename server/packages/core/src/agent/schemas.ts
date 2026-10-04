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

// A document from the model. Two shapes get normalised before the schema sees
// them, because both are things real models do here and neither is worth
// failing a run over. Anything else still has to be a valid document.
export const ModelDocumentSchema = z.preprocess((v) => {
  let value = v;
  // Some models return a nested object as a JSON string.
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  // The envelope's own message list is also called "a2ui", so a model asked for
  // a document in a field named "a2ui" routinely hands back the bare message
  // array instead of the envelope around it. Put the envelope back.
  if (Array.isArray(value)) return { a2ui: value };
  return value;
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
