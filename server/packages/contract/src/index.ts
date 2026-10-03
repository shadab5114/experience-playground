// The shared contract: AgentRequest, AgentEvent, composition shapes and the
// A2UI wire types. The playground imports this same package. Changing it
// changes the spec, so say so in the PR. The interfaces are the spec; the
// Zod schemas check the same shapes at runtime.
import { z } from "zod";
import { A2UIDocumentSchema } from "./a2ui";

export * from "./a2ui";

export const CompositionSummary = z.object({
  compositionId: z.string(),
  name: z.string(),
  type: z.string(),
  tags: z.array(z.string()),
});
export type CompositionSummary = z.infer<typeof CompositionSummary>;

export const CompositionDetail = CompositionSummary.extend({
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
export const AgentRequest = z.object({
  experienceId: z.string().min(1),
  compositionId: z.string().min(1),
  currentA2ui: A2UIDocumentSchema,
  prompt: z.string().min(1),
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
  z.object({
    type: z.literal("error"),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

// Every stream ends with exactly one of these.
export const TERMINAL_EVENT_TYPES = ["result", "answer", "refusal", "scope", "error"] as const;
