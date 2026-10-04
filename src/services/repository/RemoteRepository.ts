import { CompositionDetail, CompositionSummary, PlacementView } from '@experience-agent/contract'
import type { A2UIDocument } from '../../a2ui/types'
import type { Composition, CompositionMapping, Experience, PageTemplate, SavedComposition } from '../../types/domain'
import type { Repository } from './Repository'
import { readSavedComposition, writeSavedComposition } from './savedCompositions'

type Fetch = typeof fetch
interface Parser<T> {
  parse(input: unknown): T
}

/** Slots a page document declares, read from its Slot nodes. */
function slotsOf(doc: A2UIDocument): { id: string; description: string }[] {
  return doc.a2ui.flatMap((message) =>
    'updateComponents' in message ? message.updateComponents.components : [],
  )
    .filter((node) => node.component === 'Slot' && typeof node.slotId === 'string')
    .map((node) => ({ id: node.slotId as string, description: '' }))
}

/**
 * Reads compositions and placements from the Experience Agent backend.
 * Every response is checked against the shared contract schemas.
 */
export class RemoteRepository implements Repository {
  // Page templates arrive with a composition's placements, so they are cached
  // here. The task store calls getMapping before getPageTemplate.
  private readonly pageTemplatesById = new Map<string, PageTemplate>()

  private readonly baseUrl: string
  private readonly fetchImpl: Fetch

  // Wrapped so the browser calls fetch unbound; calling it as a method of this class throws "Illegal invocation".
  constructor(baseUrl: string, fetchImpl: Fetch = (input, init) => fetch(input, init)) {
    this.baseUrl = baseUrl
    this.fetchImpl = fetchImpl
  }

  async listExperiences(): Promise<Experience[]> {
    const compositions = await this.getJson('/v1/compositions', CompositionSummary.array())
    // The backend has no separate experiences table yet, so each composition is one experience.
    return compositions.map((c) => ({
      id: c.compositionId,
      name: c.name,
      description: c.tags.length > 0 ? c.tags.join(', ') : undefined,
      compositionId: c.compositionId,
    }))
  }

  async getComposition(id: string): Promise<Composition> {
    const detail = await this.getJson(`/v1/compositions/${encodeURIComponent(id)}`, CompositionDetail)
    return { id: detail.compositionId, name: detail.name, a2ui: detail.a2ui }
  }

  async getMapping(compositionId: string): Promise<CompositionMapping> {
    const placements = await this.getJson(
      `/v1/compositions/${encodeURIComponent(compositionId)}/placements`,
      PlacementView.array(),
    )
    // Always overwrite: the response carries the current page document, and the
    // cache exists so getPageTemplate can answer without a second round trip,
    // not to avoid refetching. Keeping a stale entry would hide a page edited in
    // the Studio for the rest of the session.
    for (const p of placements) {
      this.pageTemplatesById.set(p.pageTemplateId, {
        id: p.pageTemplateId,
        name: p.pageName,
        a2ui: p.pageA2ui,
        slots: slotsOf(p.pageA2ui),
      })
    }
    return {
      compositionId,
      appearsIn: placements.map((p) => ({
        flowId: p.flowId,
        flowName: p.flowName,
        pageTemplateId: p.pageTemplateId,
        slotId: p.slotId,
        ...(p.variant ? { variant: p.variant } : {}),
      })),
    }
  }

  async getPageTemplate(id: string): Promise<PageTemplate> {
    const template = this.pageTemplatesById.get(id)
    if (!template) throw new Error(`Page template ${id} is not loaded; load its composition's mapping first`)
    return template
  }

  getSavedComposition(compositionId: string): Promise<SavedComposition | null> {
    return readSavedComposition(compositionId)
  }

  saveComposition(saved: SavedComposition): Promise<void> {
    return writeSavedComposition(saved)
  }

  private async getJson<T>(path: string, schema: Parser<T>): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path)
    if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`)
    return schema.parse(await res.json())
  }
}
