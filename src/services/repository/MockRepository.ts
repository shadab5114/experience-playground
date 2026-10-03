import type { Composition, CompositionMapping, Experience, PageTemplate, SavedComposition } from '../../types/domain'
import type { Repository } from './Repository'
import experiencesData from '../../mocks/experiences.json'
import mappingsData from '../../mocks/mappings.json'

// Eagerly bundled so a new fixture file needs no wiring beyond dropping it here.
const compositionModules = import.meta.glob<{ default: { id: string; name: string; a2ui: unknown } }>(
  '../../mocks/compositions/*.json',
  { eager: true },
)

const compositionsById = new Map<string, Composition>(
  Object.values(compositionModules).map((mod) => {
    const raw = mod.default
    return [raw.id, { id: raw.id, name: raw.name, a2ui: raw.a2ui as Composition['a2ui'] }]
  }),
)

const pageModules = import.meta.glob<{ default: { id: string; name: string; slots: { id: string; description: string }[]; a2ui: unknown } }>(
  '../../mocks/pages/*.json',
  { eager: true },
)

const pageTemplatesById = new Map<string, PageTemplate>(
  Object.values(pageModules).map((mod) => {
    const raw = mod.default
    return [raw.id, { id: raw.id, name: raw.name, slots: raw.slots, a2ui: raw.a2ui as PageTemplate['a2ui'] }]
  }),
)

const mappingsByCompositionId = new Map<string, CompositionMapping>(
  (mappingsData as CompositionMapping[]).map((mapping) => [mapping.compositionId, mapping]),
)

const SAVE_KEY_PREFIX = 'experience-playground:saved:'

/**
 * Fixtures + localStorage, per the plan's Mock repository section. Catalog,
 * compositions, page templates, mappings and scenarios load from static
 * JSON; saved compositions persist to localStorage keyed by compositionId
 * (one saved version per composition, a later save overwrites the earlier one).
 */
export class MockRepository implements Repository {
  async listExperiences(): Promise<Experience[]> {
    return experiencesData as Experience[]
  }

  async getComposition(id: string): Promise<Composition> {
    const composition = compositionsById.get(id)
    if (!composition) throw new Error(`Unknown composition: ${id}`)
    return composition
  }

  async getMapping(compositionId: string): Promise<CompositionMapping> {
    // A composition with no mappings.json entry simply appears nowhere — not an error.
    return mappingsByCompositionId.get(compositionId) ?? { compositionId, appearsIn: [] }
  }

  async getPageTemplate(id: string): Promise<PageTemplate> {
    const template = pageTemplatesById.get(id)
    if (!template) throw new Error(`Unknown page template: ${id}`)
    return template
  }

  async getSavedComposition(compositionId: string): Promise<SavedComposition | null> {
    try {
      const raw = localStorage.getItem(SAVE_KEY_PREFIX + compositionId)
      return raw ? (JSON.parse(raw) as SavedComposition) : null
    } catch {
      return null
    }
  }

  async saveComposition(saved: SavedComposition): Promise<void> {
    localStorage.setItem(SAVE_KEY_PREFIX + saved.compositionId, JSON.stringify(saved))
  }
}
