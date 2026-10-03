import type { A2UIDocument } from '../../a2ui/types'

export interface AgentRequest {
  threadId: string
  experienceId: string
  /** The lock. */
  compositionId: string
  /** Current version's A2UI, so the agent edits what the user sees. */
  currentA2ui: A2UIDocument
  prompt: string
}

export type AgentEvent =
  | { type: 'status'; stepId: string; label: string; state: 'running' | 'done' }
  | { type: 'result'; a2ui: A2UIDocument; summary: string; message: string }
  | { type: 'refusal'; reason: string; alternatives: string[] }
  | { type: 'scope'; message: string }
  | { type: 'error'; message: string; retryable: boolean }

export interface AgentClient {
  sendPrompt(req: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent>
}
