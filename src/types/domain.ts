import type { A2UIDocument } from '../a2ui/types'

export interface Experience {
  id: string
  name: string
  description?: string
  compositionId: string
}

export interface Composition {
  id: string
  name: string
  /** The original template this experience starts from. */
  a2ui: A2UIDocument
}

export interface PageTemplate {
  id: string
  name: string
  a2ui: A2UIDocument
  slots: { id: string; description: string }[]
}

/** Where a composition appears across flows/pages. Drives the Impacts view (M5). */
export interface Placement {
  flowId: string
  flowName: string
  pageTemplateId: string
  slotId: string
  variant?: string
}

export interface CompositionMapping {
  compositionId: string
  /** Order = tab order in the Impacts view. */
  appearsIn: Placement[]
}

export interface Version {
  /** 1 = the template (or the saved version) the task started from. */
  number: number
  a2ui: A2UIDocument
  summary: string
  createdAt: string
}

export type ChatMessage =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'status'; id: string; steps: { id: string; label: string; state: 'running' | 'done' }[] }
  | { kind: 'result'; id: string; version: number; summary: string }
  | { kind: 'refusal'; id: string; reason: string; alternatives: string[] }
  | { kind: 'scope'; id: string; text: string }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'error'; id: string; text: string; retryPrompt?: string }

export interface TaskState {
  threadId: string
  experienceId: string
  experienceName: string
  /** The lock: every prompt targets only this composition. */
  compositionId: string
  versions: Version[]
  /** Moves with undo/redo. */
  currentVersion: number
  lastSavedVersion: number | null
  /** lastSavedVersion ?? 1 */
  baselineVersion: number
  view: {
    mode: 'preview' | 'json' | 'impacts'
    impactTab?: string
    device: 'mobile' | 'desktop'
  }
  agentStatus: 'idle' | 'working'
  messages: ChatMessage[]
}

export interface SavedComposition {
  compositionId: string
  a2ui: A2UIDocument
  summary: string
  savedAt: string
}
