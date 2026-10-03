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

interface TaskStore {
  /** `null` before an experience is picked. */
  task: TaskState | null
  experiences: Experience[]
  experiencesLoaded: boolean
  /** `null` until a task is picked; `{ compositionId, appearsIn: [] }` once loaded if nothing maps to it. */
  mapping: CompositionMapping | null
  /** Every page template referenced by `mapping.appearsIn`, keyed by pageTemplateId. */
  pageTemplatesById: Record<string, PageTemplate>

  loadExperiences(): Promise<void>
  pickExperience(experienceId: string): Promise<void>
  closeTask(): void
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
  experiences: [],
  experiencesLoaded: false,
  mapping: null,
  pageTemplatesById: {},

  async loadExperiences() {
    if (get().experiencesLoaded) return
    const experiences = await repository.listExperiences()
    set({ experiences, experiencesLoaded: true })
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

    set({ task, mapping: null, pageTemplatesById: {} })

    // Impacts view data: who this composition appears in, and the page
    // templates those placements need. Loaded alongside the task (not lazily
    // on first "View impacts" click) so the toolbar knows upfront whether to
    // show the button at all.
    const mapping = await repository.getMapping(experience.compositionId)
    const uniquePageTemplateIds = [...new Set(mapping.appearsIn.map((p) => p.pageTemplateId))]
    const pageTemplates = await Promise.all(uniquePageTemplateIds.map((id) => repository.getPageTemplate(id)))
    const pageTemplatesById = Object.fromEntries(pageTemplates.map((t) => [t.id, t]))

    // The task may have been closed/switched while these loads were in flight.
    if (get().task?.threadId === task.threadId) {
      set({ mapping, pageTemplatesById })
    }
  },

  closeTask() {
    set({ task: null, mapping: null, pageTemplatesById: {} })
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
          const message: ChatMessage = { kind: 'refusal', id: newId(), reason: event.reason, alternatives: event.alternatives }
          set((state) => (state.task ? { task: { ...state.task, messages: [...state.task.messages, message] } } : state))
        } else if (event.type === 'scope') {
          const message: ChatMessage = { kind: 'scope', id: newId(), text: event.message }
          set((state) => (state.task ? { task: { ...state.task, messages: [...state.task.messages, message] } } : state))
        } else if (event.type === 'error') {
          const message: ChatMessage = { kind: 'error', id: newId(), text: event.message, retryPrompt: text }
          set((state) => (state.task ? { task: { ...state.task, messages: [...state.task.messages, message] } } : state))
        }
      }
    } finally {
      set((state) => (state.task ? { task: { ...state.task, agentStatus: 'idle' } } : state))
    }
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

/** Derived, never stored. */
export function hasUnsavedChanges(task: TaskState): boolean {
  return task.currentVersion !== task.baselineVersion
}

export function getCurrentVersion(task: TaskState) {
  const version = task.versions.find((v) => v.number === task.currentVersion)
  if (!version) throw new Error(`Version ${task.currentVersion} not found`)
  return version
}
