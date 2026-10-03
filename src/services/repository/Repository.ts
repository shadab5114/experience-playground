import type { Composition, CompositionMapping, Experience, PageTemplate, SavedComposition } from '../../types/domain'

export interface Repository {
  listExperiences(): Promise<Experience[]>
  getComposition(id: string): Promise<Composition>
  getMapping(compositionId: string): Promise<CompositionMapping>
  getPageTemplate(id: string): Promise<PageTemplate>
  getSavedComposition(compositionId: string): Promise<SavedComposition | null>
  saveComposition(saved: SavedComposition): Promise<void>
}
