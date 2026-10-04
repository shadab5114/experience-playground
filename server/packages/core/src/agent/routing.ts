// Edge decisions for the graph, as plain functions so each one is unit-testable
// without a model or a database. The graph adapter wires them as conditional edges.
import type { AgentState } from "./state";

// After this many repairs a draft that still fails validation becomes an error.
export const MAX_REPAIR_ATTEMPTS = 2;

export const afterRoute = (s: AgentState): "gather" | "find" | "respond" => {
  if (s.route?.kind === "edit" || s.route?.kind === "ask") return "gather";
  if (s.route?.kind === "switch") return "find";
  return "respond";
};

export const afterFind = (): "respond" => "respond";

export const afterGather = (s: AgentState): "generate" | "respond" =>
  s.route?.kind === "ask" ? "respond" : "generate";

export const afterGenerate = (s: AgentState): "respond" | "validate" => (s.refusal ? "respond" : "validate");

export const afterValidate = (s: AgentState): "respond" | "repair" => {
  if (s.validationErrors.length === 0) return "respond";
  return s.repairAttempts < MAX_REPAIR_ATTEMPTS ? "repair" : "respond";
};
