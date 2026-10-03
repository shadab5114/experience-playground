// The LangGraph adapter. It is the only code that imports LangGraph. It wires
// the core's nodes and routing functions into a StateGraph, keeps thread memory
// in the Postgres checkpointer, and streams the nodes' events out as AgentEvents.
import { Annotation, END, START, StateGraph, type BaseCheckpointSaver, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type pg from "pg";
import { AgentEvent, type AgentRequest } from "@experience-agent/contract";
import {
  afterGather,
  afterGenerate,
  afterRoute,
  afterValidate,
  startRun,
  type AgentEngine,
  type AgentState,
  type ChatMessage,
  type NodeFn,
  type Nodes,
} from "@experience-agent/core";

// Channels mirror the core's AgentState. Only `messages` survives between runs;
// everything else is reset by startRun() at the start of each run.
export const GraphState = Annotation.Root({
  request: Annotation<AgentRequest>(),
  messages: Annotation<ChatMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  route: Annotation<AgentState["route"]>(),
  context: Annotation<AgentState["context"]>(),
  draft: Annotation<AgentState["draft"]>(),
  draftSummary: Annotation<AgentState["draftSummary"]>(),
  draftMessage: Annotation<AgentState["draftMessage"]>(),
  refusal: Annotation<AgentState["refusal"]>(),
  validationErrors: Annotation<AgentState["validationErrors"]>(),
  repairAttempts: Annotation<AgentState["repairAttempts"]>(),
});

// Each core node writes its events to LangGraph's custom stream, which the engine forwards.
const asNode = (fn: NodeFn) => async (state: AgentState, config: LangGraphRunnableConfig) =>
  fn(state, (event) => config.writer?.(event));

// The route node is named "classify": LangGraph does not allow a node to share a
// name with a state channel, and "route" is the channel that holds its output.
// Status events still use the step id "route" (see core's LABELS).
export function buildGraph(nodes: Nodes) {
  return new StateGraph(GraphState)
    .addNode("classify", asNode(nodes.route))
    .addNode("gather", asNode(nodes.gather))
    .addNode("generate", asNode(nodes.generate))
    .addNode("validate", asNode(nodes.validate))
    .addNode("repair", asNode(nodes.repair))
    .addNode("respond", asNode(nodes.respond))
    .addEdge(START, "classify")
    .addConditionalEdges("classify", afterRoute)
    .addConditionalEdges("gather", afterGather)
    .addConditionalEdges("generate", afterGenerate)
    .addConditionalEdges("validate", afterValidate)
    .addEdge("repair", "validate")
    .addEdge("respond", END);
}

export function createAgentEngine(options: { nodes: Nodes; checkpointer: BaseCheckpointSaver }): AgentEngine {
  const graph = buildGraph(options.nodes).compile({ checkpointer: options.checkpointer });
  return {
    async *run({ request, threadId }, signal) {
      const stream = await graph.stream(startRun(request), {
        configurable: { thread_id: threadId },
        streamMode: "custom",
        signal,
      });
      for await (const chunk of stream) yield AgentEvent.parse(chunk);
    },
  };
}

// Creates the checkpoint tables if they are missing, then returns the saver.
export async function createPostgresCheckpointer(pool: pg.Pool): Promise<BaseCheckpointSaver> {
  const saver = new PostgresSaver(pool);
  await saver.setup();
  return saver;
}
