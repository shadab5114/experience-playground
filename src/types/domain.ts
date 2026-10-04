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

/** A page a composition appears on. Drives the Impacts view (M5), one tab per page. */
export interface Placement {
  pageTemplateId: string
  pageName: string
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
  // The agent asked to open another composition. Shown only when there is unsaved work.
  | { kind: 'switch'; id: string; compositionId: string; name: string; text: string }

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
    /** The pageTemplateId of the open Impacts tab. */
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
