// What the model returns at each structured step. Each schema is an object at
// the top level, because a tool's input schema must be one.
import { z } from "zod";
import { A2UIDocumentSchema } from "@experience-agent/contract";

export const RouteSchema = z.object({
  kind: z.enum(["edit", "ask", "scope", "unsupported"]),
  components: z.array(z.string()),
  topic: z.string().nullable(),
  message: z.string(),
});

export const GenerateSchema = z.object({
  kind: z.enum(["edit", "refusal"]),
  // Set when kind is "edit".
  a2ui: A2UIDocumentSchema.nullable(),
  summary: z.string().nullable(),
  message: z.string().nullable(),
  // Set when kind is "refusal".
  reason: z.string().nullable(),
  alternatives: z.array(z.string()),
});
export type GenerateOutput = z.infer<typeof GenerateSchema>;
