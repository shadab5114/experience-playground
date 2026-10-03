// AgentRequest and AgentEvent come from the shared contract package.
import type { AgentEvent, AgentRequest } from '@experience-agent/contract'

export type { AgentEvent, AgentRequest }

export interface AgentClient {
  /** The thread id is the task id; it is not part of the request body. */
  sendPrompt(threadId: string, req: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent>
}
