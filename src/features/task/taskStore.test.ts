import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentEvent } from '@experience-agent/contract'
import type { A2UIDocument } from '../../a2ui/types'

// The store talks only to these two services, so they are the only things mocked.
const { agent, repo } = vi.hoisted(() => ({
  agent: { sendPrompt: vi.fn() },
  repo: {
    listExperiences: vi.fn(),
    getComposition: vi.fn(),
    getSavedComposition: vi.fn(),
    getMapping: vi.fn(),
    getPageTemplate: vi.fn(),
    saveComposition: vi.fn(),
  },
}))

vi.mock('../../services/createServices', () => ({ services: { agentClient: agent, repository: repo } }))

import { useTaskStore } from './taskStore'

const doc: A2UIDocument = {
  a2ui: [{ version: 'v0.9', createSurface: { surfaceId: 'main', catalogId: 'x' } }],
}

const EXPERIENCES = [
  { id: 'basic-plan-mobile', name: 'Basic Plan – Mobile', compositionId: 'basic-plan-tile' },
  { id: 'order-summary', name: 'Order Summary', compositionId: 'order-summary-tile' },
  { id: 'home-plan', name: 'Home Plan', compositionId: 'home-plan-tile' },
]

// Yields the given events in order, as the agent client does.
function streamOf(events: AgentEvent[]) {
  return (async function* () {
    for (const e of events) yield e
  })()
}

const result: AgentEvent = { type: 'result', a2ui: doc, summary: 'Changed the cap', message: 'Done.' }

async function openTask(compositionExperienceId = 'basic-plan-mobile') {
  await useTaskStore.getState().loadExperiences()
  await useTaskStore.getState().pickExperience(compositionExperienceId)
}

beforeEach(() => {
  vi.clearAllMocks()
  useTaskStore.setState({ task: null, draft: null, experiences: [], experiencesLoaded: false, mapping: null, pageTemplatesById: {} })
  repo.listExperiences.mockResolvedValue(EXPERIENCES)
  repo.getComposition.mockImplementation(async (id: string) => ({
    compositionId: id,
    name: id,
    type: 'plan-tile',
    tags: [],
    a2ui: doc,
  }))
  repo.getSavedComposition.mockResolvedValue(null)
  repo.getMapping.mockImplementation(async (id: string) => ({ compositionId: id, appearsIn: [] }))
  repo.getPageTemplate.mockResolvedValue(undefined)
})

describe('task store: stream events', () => {
  test('an answer is shown as an agent message', async () => {
    await openTask()
    agent.sendPrompt.mockReturnValue(streamOf([{ type: 'answer', text: 'Basic Plan – Mobile is already open.' }]))

    await useTaskStore.getState().sendPrompt('bring me Basic Plan Tile')

    const last = useTaskStore.getState().task!.messages.at(-1)
    expect(last).toMatchObject({ kind: 'agent', text: 'Basic Plan – Mobile is already open.' })
  })

  test('a stream that ends without a visible reply says so and offers a retry', async () => {
    await openTask()
    agent.sendPrompt.mockReturnValue(streamOf([{ type: 'status', stepId: 'route', label: 'Understanding your request', state: 'done' }]))

    await useTaskStore.getState().sendPrompt('hello')

    const last = useTaskStore.getState().task!.messages.at(-1)
    expect(last).toMatchObject({ kind: 'error', text: 'The agent finished without a reply you can see. Try again.', retryPrompt: 'hello' })
  })
})

describe('task store: switching composition', () => {
  test('a switch with no unsaved work opens the target straight away', async () => {
    await openTask()
    agent.sendPrompt.mockReturnValue(
      streamOf([{ type: 'switch', compositionId: 'order-summary-tile', name: 'Order Summary', message: 'Opening Order Summary.' }]),
    )

    await useTaskStore.getState().sendPrompt('show me order summary')

    const task = useTaskStore.getState().task!
    expect(task.compositionId).toBe('order-summary-tile')
    expect(task.experienceName).toBe('Order Summary')
    expect(task.messages.some((m) => m.kind === 'switch')).toBe(false)
  })

  test('a switch with unsaved work asks first and keeps the current task', async () => {
    await openTask()
    agent.sendPrompt.mockReturnValueOnce(streamOf([result]))
    await useTaskStore.getState().sendPrompt('make the cap red')
    expect(useTaskStore.getState().task!.currentVersion).toBe(2)

    agent.sendPrompt.mockReturnValueOnce(
      streamOf([{ type: 'switch', compositionId: 'order-summary-tile', name: 'Order Summary', message: 'Opening Order Summary. Unsaved work in this task will be discarded.' }]),
    )
    await useTaskStore.getState().sendPrompt('show me order summary')

    const task = useTaskStore.getState().task!
    expect(task.compositionId).toBe('basic-plan-tile')
    const card = task.messages.at(-1)
    expect(card).toMatchObject({ kind: 'switch', compositionId: 'order-summary-tile', name: 'Order Summary' })
  })

  test('confirming the card discards the unsaved work and opens the target', async () => {
    await openTask()
    agent.sendPrompt.mockReturnValueOnce(streamOf([result]))
    await useTaskStore.getState().sendPrompt('make the cap red')
    agent.sendPrompt.mockReturnValueOnce(
      streamOf([{ type: 'switch', compositionId: 'order-summary-tile', name: 'Order Summary', message: 'Opening Order Summary.' }]),
    )
    await useTaskStore.getState().sendPrompt('show me order summary')

    await useTaskStore.getState().switchTo('order-summary-tile')

    const task = useTaskStore.getState().task!
    expect(task.compositionId).toBe('order-summary-tile')
    expect(task.currentVersion).toBe(1)
  })

  test('staying removes the card and keeps the current task', async () => {
    await openTask()
    agent.sendPrompt.mockReturnValueOnce(streamOf([result]))
    await useTaskStore.getState().sendPrompt('make the cap red')
    agent.sendPrompt.mockReturnValueOnce(
      streamOf([{ type: 'switch', compositionId: 'order-summary-tile', name: 'Order Summary', message: 'Opening Order Summary.' }]),
    )
    await useTaskStore.getState().sendPrompt('show me order summary')
    const card = useTaskStore.getState().task!.messages.at(-1)!

    useTaskStore.getState().dismissMessage(card.id)

    const task = useTaskStore.getState().task!
    expect(task.compositionId).toBe('basic-plan-tile')
    expect(task.messages.some((m) => m.kind === 'switch')).toBe(false)
  })

  test('a target that is not in the picker list is reported, not silently ignored', async () => {
    await openTask()

    await useTaskStore.getState().switchTo('no-such-composition')

    const last = useTaskStore.getState().task!.messages.at(-1)
    expect(last).toMatchObject({ kind: 'error', text: "I couldn't open composition no-such-composition." })
    expect(useTaskStore.getState().task!.compositionId).toBe('basic-plan-tile')
  })
})

describe('task store: chat-first start (no tile picked)', () => {
  test('a typed request is sent without a composition and its answer shows in the chat', async () => {
    agent.sendPrompt.mockReturnValue(streamOf([{ type: 'answer', text: 'Which tile would you like to see?' }]))

    await useTaskStore.getState().sendChatFirstPrompt('what can you do')

    expect(agent.sendPrompt.mock.calls[0]?.[1]).toEqual({ prompt: 'what can you do' })
    const draft = useTaskStore.getState().draft!
    expect(draft.messages.map((m) => m.kind)).toEqual(['user', 'agent'])
    expect(useTaskStore.getState().task).toBeNull()
  })

  test('a switch opens the tile and keeps the typed request above the greeting', async () => {
    agent.sendPrompt.mockReturnValue(
      streamOf([{ type: 'switch', compositionId: 'home-plan-tile', name: 'Home Plan', message: 'Opening Home Plan.' }]),
    )

    await useTaskStore.getState().sendChatFirstPrompt('show me home plan')

    const state = useTaskStore.getState()
    expect(state.draft).toBeNull()
    expect(state.task!.compositionId).toBe('home-plan-tile')
    expect(state.task!.messages[0]).toMatchObject({ kind: 'user', text: 'show me home plan' })
    expect(state.task!.messages[1]).toMatchObject({ kind: 'agent' })
  })

  test('a silent stream in the chat-first start says so and offers a retry', async () => {
    agent.sendPrompt.mockReturnValue(streamOf([{ type: 'status', stepId: 'route', label: 'Understanding your request', state: 'done' }]))

    await useTaskStore.getState().sendChatFirstPrompt('hello')

    const last = useTaskStore.getState().draft!.messages.at(-1)
    expect(last).toMatchObject({ kind: 'error', text: 'The agent finished without a reply you can see. Try again.', retryPrompt: 'hello' })
  })

  test('a chat-first prompt does nothing while a task is open', async () => {
    await openTask()

    await useTaskStore.getState().sendChatFirstPrompt('show me home plan')

    expect(agent.sendPrompt).not.toHaveBeenCalled()
    expect(useTaskStore.getState().draft).toBeNull()
  })
})
