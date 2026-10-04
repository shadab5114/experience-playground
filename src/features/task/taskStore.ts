import { create } from 'zustand'
import { services } from '../../services/createServices'
import type { ChatMessage, CompositionMapping, Experience, PageTemplate, TaskState } from '../../types/domain'

// Only this store talks to AgentClient/Repository — see "How a prompt
// travels" in docs/PLAN.md. UI components only read/write this store.
// Which implementations run (mock or remote) is decided in createServices.ts.
const { agentClient, repository } = services

function newId(): string {
  return crypto.randomUUID()
}

/** A chat started before any tile is chosen. It becomes a task when the agent opens one. */
export interface ChatDraft {
  threadId: string
  messages: ChatMessage[]
  agentStatus: 'idle' | 'working'
}

interface TaskStore {
  /** `null` before an experience is picked. */
  task: TaskState | null
  /** The conversation started by typing before any tile is picked. `null` otherwise. */
  draft: ChatDraft | null
  experiences: Experience[]
  experiencesLoaded: boolean
  /** `null` until a task is picked; `{ compositionId, appearsIn: [] }` once loaded if nothing maps to it. */
  mapping: CompositionMapping | null
  /** Every page template referenced by `mapping.appearsIn`, keyed by pageTemplateId. */
  pageTemplatesById: Record<string, PageTemplate>

  loadExperiences(): Promise<void>
  /**
   * Marks the experience list stale so the next loadExperiences() refetches.
   * Called by the Studio after it creates, edits or deletes a composition —
   * otherwise a tile authored there is missing from the picker until a reload,
   * which looks exactly like the save having failed.
   */
  invalidateExperiences(): void
  /**
   * Re-reads the open task's mapping and the page templates it needs. Called by
   * the Studio after a placement changes, so the Impacts view picks up a new
   * tab without the designer having to reopen the task.
   */
  reloadMapping(): Promise<void>
  pickExperience(experienceId: string): Promise<void>
  closeTask(): void
  /** Discards the current task and opens another composition, keeping `carry` messages in the chat. */
  switchTo(compositionId: string, carry?: ChatMessage[]): Promise<void>
  dismissMessage(messageId: string): void
  /** A prompt typed before any tile is picked. The agent may open a tile from it. */
  sendChatFirstPrompt(text: string): Promise<void>
  sendPrompt(text: string): Promise<void>
  undo(): void
  redo(): void
  save(): Promise<void>
  setViewMode(mode: TaskState['view']['mode']): void
  setImpactTab(flowId: string): void
  setDevice(device: TaskState['view']['device']): void
}

function currentA2ui(task: TaskState) {
  const version = task.versions.find((v) => v.number === task.currentVersion)
  if (!version) throw new Error(`Version ${task.currentVersion} not found`)
  return version.a2ui
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  task: null,
  draft: null,
  experiences: [],
  experiencesLoaded: false,
  mapping: null,
  pageTemplatesById: {},

  async loadExperiences() {
    if (get().experiencesLoaded) return
    const experiences = await repository.listExperiences()
    set({ experiences, experiencesLoaded: true })
  },

  invalidateExperiences() {
    set({ experiencesLoaded: false })
  },

  async pickExperience(experienceId: string) {
    const experience = get().experiences.find((e) => e.id === experienceId)
    if (!experience) throw new Error(`Unknown experience: ${experienceId}`)

    const [composition, saved] = await Promise.all([
      repository.getComposition(experience.compositionId),
      repository.getSavedComposition(experience.compositionId),
    ])

    // Default: start from the saved version if one exists, else the template.
    const startingA2ui = saved?.a2ui ?? composition.a2ui
    const startingSummary = saved ? 'Saved version' : 'Original template'

    const greeting: ChatMessage = {
      kind: 'agent',
      id: newId(),
      text: `You selected ${experience.name}. What would you like to work on? You can ask me to design, update, or modify this experience within brand guidelines.`,
    }

    const task: TaskState = {
      threadId: newId(),
      experienceId: experience.id,
      experienceName: experience.name,
      compositionId: experience.compositionId,
      versions: [{ number: 1, a2ui: startingA2ui, summary: startingSummary, createdAt: new Date().toISOString() }],
      currentVersion: 1,
      lastSavedVersion: saved ? 1 : null,
      baselineVersion: saved ? 1 : 1,
      view: { mode: 'preview', device: 'mobile' },
      agentStatus: 'idle',
      messages: [greeting],
    }

    set({ task, draft: null, mapping: null, pageTemplatesById: {} })

    // Impacts view data: who this composition appears in, and the page
    // templates those placements need. Loaded alongside the task (not lazily
    // on first "View impacts" click) so the toolbar knows upfront whether to
    // show the button at all.
    const loaded = await loadMapping(experience.compositionId)

    // The task may have been closed/switched while these loads were in flight.
    if (get().task?.threadId === task.threadId) {
      set(loaded)
    }
  },

  async reloadMapping() {
    const task = get().task
    if (!task) return
    const loaded = await loadMapping(task.compositionId)
    if (get().task?.threadId === task.threadId) set(loaded)
  },

  closeTask() {
    set({ task: null, draft: null, mapping: null, pageTemplatesById: {} })
  },

  async sendPrompt(text: string) {
    const task = get().task
    if (!task || task.agentStatus === 'working') return

    const userMessage: ChatMessage = { kind: 'user', id: newId(), text }
    set({ task: { ...task, agentStatus: 'working', messages: [...task.messages, userMessage] } })

    const statusMessageId = newId()
    const steps: { id: string; label: string; state: 'running' | 'done' }[] = []

    const pushStatusMessage = () => {
      set((state) => {
        if (!state.task) return state
        const withoutStatus = state.task.messages.filter((m) => m.id !== statusMessageId)
        const statusMessage: ChatMessage = { kind: 'status', id: statusMessageId, steps: [...steps] }
        return { task: { ...state.task, messages: [...withoutStatus, statusMessage] } }
      })
    }

    try {
      const req = {
        experienceId: task.experienceId,
        compositionId: task.compositionId,
        currentA2ui: currentA2ui(task),
        prompt: text,
      }

      // Set once the stream gives the designer something visible. Otherwise a fallback says so.
      let handled = false

      for await (const event of agentClient.sendPrompt(task.threadId, req)) {
        if (event.type === 'status') {
          const existing = steps.find((s) => s.id === event.stepId)
          if (existing) {
            existing.state = event.state
            existing.label = event.label
          } else {
            steps.push({ id: event.stepId, label: event.label, state: event.state })
          }
          pushStatusMessage()
          continue
        }

        if (event.type === 'result') {
          handled = true
          set((state) => {
            if (!state.task) return state
            const nextNumber = Math.max(...state.task.versions.map((v) => v.number)) + 1
            // A new prompt after undo drops the redo history ahead of currentVersion.
            const versionsUpToCurrent = state.task.versions.filter((v) => v.number <= state.task!.currentVersion)
            const newVersion = { number: nextNumber, a2ui: event.a2ui, summary: event.summary, createdAt: new Date().toISOString() }
            const resultMessage: ChatMessage = { kind: 'result', id: newId(), version: nextNumber, summary: event.summary }
            const agentMessage: ChatMessage = { kind: 'agent', id: newId(), text: `${event.message} (v${nextNumber}, not saved yet)` }
            return {
              task: {
                ...state.task,
                versions: [...versionsUpToCurrent, newVersion],
                currentVersion: nextNumber,
                messages: [...state.task.messages, resultMessage, agentMessage],
              },
            }
          })
        } else if (event.type === 'refusal') {
          handled = true
          const message: ChatMessage = { kind: 'refusal', id: newId(), reason: event.reason, alternatives: event.alternatives }
          set((state) => (state.task ? { task: { ...state.task, messages: [...state.task.messages, message] } } : state))
        } else if (event.type === 'scope') {
          handled = true
          const message: ChatMessage = { kind: 'scope', id: newId(), text: event.message }
          set((state) => (state.task ? { task: { ...state.task, messages: [...state.task.messages, message] } } : state))
        } else if (event.type === 'answer') {
          handled = true
          const message: ChatMessage = { kind: 'agent', id: newId(), text: event.text }
          set((state) => (state.task ? { task: { ...state.task, messages: [...state.task.messages, message] } } : state))
        } else if (event.type === 'switch') {
          handled = true
          const current = get().task
          if (current && hasUnsavedChanges(current)) {
            // Ask first: the designer may want to keep the unsaved work.
            const message: ChatMessage = {
              kind: 'switch',
              id: newId(),
              compositionId: event.compositionId,
              name: event.name,
              text: event.message,
            }
            set((state) => (state.task ? { task: { ...state.task, messages: [...state.task.messages, message] } } : state))
          } else {
            await get().switchTo(event.compositionId)
          }
        } else if (event.type === 'error') {
          handled = true
          const message: ChatMessage = { kind: 'error', id: newId(), text: event.message, retryPrompt: text }
          set((state) => (state.task ? { task: { ...state.task, messages: [...state.task.messages, message] } } : state))
        }
      }

      if (!handled) {
        // Never end silently: say so, and offer a retry.
        const message: ChatMessage = {
          kind: 'error',
          id: newId(),
          text: 'The agent finished without a reply you can see. Try again.',
          retryPrompt: text,
        }
        set((state) => (state.task ? { task: { ...state.task, messages: [...state.task.messages, message] } } : state))
      }
    } finally {
      set((state) => (state.task ? { task: { ...state.task, agentStatus: 'idle' } } : state))
    }
  },

  async switchTo(compositionId: string, carry: ChatMessage[] = []) {
    let experience = get().experiences.find((e) => e.compositionId === compositionId)
    if (!experience) {
      await get().loadExperiences()
      experience = get().experiences.find((e) => e.compositionId === compositionId)
    }
    if (!experience) {
      set((state) => {
        if (!state.task) return state
        const message: ChatMessage = { kind: 'error', id: newId(), text: `I couldn't open composition ${compositionId}.` }
        return { task: { ...state.task, messages: [...state.task.messages, message] } }
      })
      return
    }
    // Same path as closing the task and picking again. Unsaved work is discarded by design.
    get().closeTask()
    await get().pickExperience(experience.id)
    // Messages from a chat started before any tile was picked stay visible above the greeting.
    if (carry.length > 0) {
      set((state) => (state.task ? { task: { ...state.task, messages: [...carry, ...state.task.messages] } } : state))
    }
  },

  async sendChatFirstPrompt(text: string) {
    if (get().task) return
    const existing = get().draft
    if (existing?.agentStatus === 'working') return
    const draft: ChatDraft = existing ?? { threadId: newId(), messages: [], agentStatus: 'idle' }

    const userMessage: ChatMessage = { kind: 'user', id: newId(), text }
    set({ draft: { ...draft, agentStatus: 'working', messages: [...draft.messages, userMessage] } })

    const statusMessageId = newId()
    const steps: { id: string; label: string; state: 'running' | 'done' }[] = []
    const pushStatusMessage = () => {
      set((state) => {
        if (!state.draft) return state
        const withoutStatus = state.draft.messages.filter((m) => m.id !== statusMessageId)
        const statusMessage: ChatMessage = { kind: 'status', id: statusMessageId, steps: [...steps] }
        return { draft: { ...state.draft, messages: [...withoutStatus, statusMessage] } }
      })
    }
    const append = (message: ChatMessage) =>
      set((state) => (state.draft ? { draft: { ...state.draft, messages: [...state.draft.messages, message] } } : state))

    let handled = false
    try {
      // No composition in the request: the agent only opens one, it never edits.
      for await (const event of agentClient.sendPrompt(draft.threadId, { prompt: text })) {
        if (event.type === 'status') {
          const existingStep = steps.find((s) => s.id === event.stepId)
          if (existingStep) {
            existingStep.state = event.state
            existingStep.label = event.label
          } else {
            steps.push({ id: event.stepId, label: event.label, state: event.state })
          }
          pushStatusMessage()
          continue
        }

        if (event.type === 'switch') {
          handled = true
          const carried = (get().draft?.messages ?? []).filter((m) => m.kind !== 'status')
          set({ draft: null })
          await get().switchTo(event.compositionId, carried)
          return
        }

        handled = true
        if (event.type === 'answer') append({ kind: 'agent', id: newId(), text: event.text })
        else if (event.type === 'refusal') append({ kind: 'refusal', id: newId(), reason: event.reason, alternatives: event.alternatives })
        else if (event.type === 'scope') append({ kind: 'scope', id: newId(), text: event.message })
        else if (event.type === 'error') append({ kind: 'error', id: newId(), text: event.message, retryPrompt: text })
        else append({ kind: 'error', id: newId(), text: 'The agent did not return a result for this request. Try again.', retryPrompt: text })
      }

      if (!handled) {
        append({ kind: 'error', id: newId(), text: 'The agent finished without a reply you can see. Try again.', retryPrompt: text })
      }
    } finally {
      set((state) => (state.draft ? { draft: { ...state.draft, agentStatus: 'idle' } } : state))
    }
  },

  dismissMessage(messageId: string) {
    set((state) => {
      if (!state.task) return state
      return { task: { ...state.task, messages: state.task.messages.filter((m) => m.id !== messageId) } }
    })
  },

  undo() {
    set((state) => {
      if (!state.task) return state
      const prev = state.task.versions.filter((v) => v.number < state.task!.currentVersion).at(-1)
      if (!prev) return state
      const note: ChatMessage = { kind: 'system', id: newId(), text: `Back to version ${prev.number}` }
      return { task: { ...state.task, currentVersion: prev.number, messages: [...state.task.messages, note] } }
    })
  },

  redo() {
    set((state) => {
      if (!state.task) return state
      const next = state.task.versions.filter((v) => v.number > state.task!.currentVersion).at(0)
      if (!next) return state
      const note: ChatMessage = { kind: 'system', id: newId(), text: `Forward to version ${next.number}` }
      return { task: { ...state.task, currentVersion: next.number, messages: [...state.task.messages, note] } }
    })
  },

  async save() {
    const task = get().task
    if (!task) return
    const version = task.versions.find((v) => v.number === task.currentVersion)
    if (!version) return
    await repository.saveComposition({
      compositionId: task.compositionId,
      a2ui: version.a2ui,
      summary: version.summary,
      savedAt: new Date().toISOString(),
    })
    const note: ChatMessage = { kind: 'system', id: newId(), text: `Saved version ${version.number}` }
    set((state) =>
      state.task
        ? { task: { ...state.task, lastSavedVersion: version.number, baselineVersion: version.number, messages: [...state.task.messages, note] } }
        : state,
    )
  },

  setViewMode(mode) {
    set((state) => (state.task ? { task: { ...state.task, view: { ...state.task.view, mode } } } : state))
  },

  setImpactTab(flowId) {
    set((state) => (state.task ? { task: { ...state.task, view: { ...state.task.view, impactTab: flowId } } } : state))
  },

  setDevice(device) {
    set((state) => (state.task ? { task: { ...state.task, view: { ...state.task.view, device } } } : state))
  },
}))

/** The Impacts view's data for one composition: where it appears, and those pages. */
async function loadMapping(compositionId: string) {
  const mapping = await repository.getMapping(compositionId)
  const uniquePageTemplateIds = [...new Set(mapping.appearsIn.map((p) => p.pageTemplateId))]
  const pageTemplates = await Promise.all(uniquePageTemplateIds.map((id) => repository.getPageTemplate(id)))
  return { mapping, pageTemplatesById: Object.fromEntries(pageTemplates.map((t) => [t.id, t])) }
}

/** Derived, never stored. */
export function hasUnsavedChanges(task: TaskState): boolean {
  return task.currentVersion !== task.baselineVersion
}

export function getCurrentVersion(task: TaskState) {
  const version = task.versions.find((v) => v.number === task.currentVersion)
  if (!version) throw new Error(`Version ${task.currentVersion} not found`)
  return version
}
