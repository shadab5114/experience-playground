// The shared contract: AgentRequest, AgentEvent, composition shapes and the
// A2UI wire types. The playground imports this same package. Changing it
// changes the spec, so say so in the PR. The interfaces are the spec; the
// Zod schemas check the same shapes at runtime.
import { z } from "zod";
import { A2UIDocumentSchema } from "./a2ui";

export * from "./a2ui";
export * from "./authoring";

export const CompositionSummary = z.object({
  compositionId: z.string(),
  name: z.string(),
  type: z.string(),
  tags: z.array(z.string()),
});
export type CompositionSummary = z.infer<typeof CompositionSummary>;

// family/description/agentRules are the prose people write in the Studio.
// They reach the model: description helps it pick a composition, agentRules
// steers how it edits this one. Empty strings rather than nulls, because the
// columns are nullable and a caller should not have to handle both.
// Defaulted, not required: a response from a build that predates these fields
// still parses, and a caller never has to handle both "" and undefined.
export const CompositionDetail = CompositionSummary.extend({
  family: z.string().default(""),
  description: z.string().default(""),
  agentRules: z.string().optional(),
  a2ui: A2UIDocumentSchema,
});
export type CompositionDetail = z.infer<typeof CompositionDetail>;

export const PlacementView = z.object({
  flowId: z.string(),
  flowName: z.string(),
  pageTemplateId: z.string(),
  pageName: z.string(),
  slotId: z.string(),
  variant: z.string().optional(),
  pageA2ui: A2UIDocumentSchema,
});
export type PlacementView = z.infer<typeof PlacementView>;

// The thread id is not part of the body. It travels in the URL path
// (POST /v1/threads/:threadId/prompts) and as the first argument to sendPrompt.
// A request with no composition is a chat-first start: the designer types before
// choosing a tile. The composition fields go together, so one never comes without the other.
export const AgentRequest = z
  .object({
    experienceId: z.string().min(1).optional(),
    compositionId: z.string().min(1).optional(),
    currentA2ui: A2UIDocumentSchema.optional(),
    prompt: z.string().min(1),
  })
  .refine((r) => (r.compositionId === undefined) === (r.currentA2ui === undefined), {
    message: "compositionId and currentA2ui must be sent together",
  })
  .refine((r) => r.experienceId === undefined || r.compositionId !== undefined, {
    message: "experienceId needs a compositionId",
  });
export type AgentRequest = z.infer<typeof AgentRequest>;

export const AgentEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    stepId: z.string(),
    label: z.string(),
    state: z.enum(["running", "done"]),
  }),
  z.object({
    type: z.literal("result"),
    a2ui: A2UIDocumentSchema,
    summary: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal("answer"),
    text: z.string(),
    references: z.array(z.object({ compositionId: z.string(), name: z.string() })).optional(),
  }),
  z.object({
    type: z.literal("refusal"),
    reason: z.string(),
    alternatives: z.array(z.string()),
  }),
  z.object({
    type: z.literal("scope"),
    message: z.string(),
  }),
  // The designer asked for another composition ("bring me Basic Plan Tile - Mobile").
  // The playground discards unsaved work and opens the target. Ends the stream.
  z.object({
    type: z.literal("switch"),
    compositionId: z.string().min(1),
    name: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

// Every stream ends with exactly one of these.
export const TERMINAL_EVENT_TYPES = ["result", "answer", "refusal", "scope", "switch", "error"] as const;
