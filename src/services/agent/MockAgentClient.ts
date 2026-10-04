import { applyPatch } from 'fast-json-patch'
import type { AgentClient, AgentEvent, AgentRequest } from './AgentClient'
import type { MockScenario } from '../../mocks/types'
import type { A2UIComponentNode } from '../../a2ui/types'
import { resolveSurface } from '../../a2ui/resolveSurface'
import { toWireDocument } from '../../a2ui/toWireDocument'
import { delay } from './delay'

// Eagerly bundled and sorted by filename, so scenario order (and the
// deliberate "scope notice checked first" ordering) is just file-naming
// (00-, 10-, 20-…) — a new demo scenario is a new JSON file, no UI/code change.
const scenarioModules = import.meta.glob<{ default: MockScenario }>('../../mocks/scenarios/*.json', { eager: true })
const defaultScenarios: MockScenario[] = Object.keys(scenarioModules)
  .sort()
  .map((key) => scenarioModules[key].default)

/** Supported-prompt examples offered as chips when nothing matches. */
const UNSUPPORTED_ALTERNATIVES = [
  'Change the cap color to red',
  'Make the badge smaller',
  "Customers say the price difference isn't clear, highlight it",
]

function findMatchingScenario(scenarios: MockScenario[], experienceId: string, prompt: string): MockScenario | undefined {
  return scenarios.find(
    (scenario) =>
      scenario.experienceIds.includes(experienceId) &&
      scenario.match.some((pattern) => new RegExp(pattern, 'i').test(prompt)),
  )
}

/** The shape scenario JSON Patches actually target — the wire document's data model and components, flattened by id. */
interface PatchableState {
  dataModel: Record<string, unknown>
  components: Record<string, A2UIComponentNode>
}

/**
 * Behaves like the real agent from the UI's point of view: same interface,
 * same streamed events, realistic timing. Every scripted behavior comes
 * from `src/mocks/scenarios/*.json`, not code.
 */
export class MockAgentClient implements AgentClient {
  private readonly scenarios: MockScenario[]

  constructor(scenarios: MockScenario[] = defaultScenarios) {
    this.scenarios = scenarios
  }

  async *sendPrompt(_threadId: string, req: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    // Mock mode has no search, so a chat-first request can only be answered by asking for a pick.
    if (req.experienceId === undefined || req.currentA2ui === undefined) {
      yield {
        type: 'refusal',
        reason: 'Pick an experience first, then describe the change. Chat-first search needs the backend (remote mode).',
        alternatives: [],
      }
      return
    }
    const scenario = findMatchingScenario(this.scenarios, req.experienceId, req.prompt)

    if (!scenario) {
      yield {
        type: 'refusal',
        reason: "I don't have a scripted response for that prompt yet. Try one of these:",
        alternatives: UNSUPPORTED_ALTERNATIVES,
      }
      return
    }

    for (const [index, step] of scenario.steps.entries()) {
      const stepId = `${scenario.id}-step-${index}`
      yield { type: 'status', stepId, label: step.label, state: 'running' }
      await delay(step.ms, signal)
      yield { type: 'status', stepId, label: step.label, state: 'done' }
    }

    const { outcome } = scenario
    if (outcome.kind === 'scope') {
      yield { type: 'scope', message: outcome.message }
      return
    }
    if (outcome.kind === 'refusal') {
      yield { type: 'refusal', reason: outcome.reason, alternatives: outcome.alternatives }
      return
    }

    // The wire document is the real transport format (an ordered message
    // log), not something JSON Patch can address sensibly by id. Resolve it
    // down to a flat, patchable { dataModel, components-by-id } shape,
    // apply the scenario's RFC 6902 patch against *that*, then re-encode
    // back into a fresh self-contained wire document for the new version.
    const surface = resolveSurface(req.currentA2ui)
    const patchTarget: PatchableState = { dataModel: surface.dataModel, components: Object.fromEntries(surface.componentsById) }
    const { newDocument: patched } = applyPatch(structuredClone(patchTarget), outcome.patch)

    const components = Object.values(patched.components)
    const newDocument = toWireDocument({
      surfaceId: surface.surfaceId || 'main',
      catalogId: surface.catalogId,
      dataModel: patched.dataModel,
      components,
      meta: {
        provider: 'mock',
        model: 'experience-playground-mock-agent',
        catalogId: surface.catalogId,
        components: [...new Set(components.map((c) => c.component))],
        generatedAt: new Date().toISOString(),
      },
    })

    yield { type: 'result', a2ui: newDocument, summary: outcome.summary, message: outcome.message }
  }
}
