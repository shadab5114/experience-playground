import type {
  CompositionInput,
  CompositionRecord,
  CompositionVersionSummary,
  DeleteImpact,
  PageTemplateInput,
  PageTemplateRecord,
  PlacementInput,
  PlacementKey,
  PlacementRecord,
  ValidationFinding,
  ValidationReport,
} from '@experience-agent/contract'

/**
 * Studio writes. A separate interface from `Repository` on purpose: the
 * playground's read path is implemented by both MockRepository and
 * RemoteRepository, while authoring exists only against the backend. Mock mode
 * has no authoring repository at all and the Studio is hidden.
 *
 * Per CLAUDE.md, only a store calls this — see features/studio/studioStore.ts.
 */
export interface AuthoringRepository {
  listCompositions(): Promise<CompositionRecord[]>
  /** Create or replace. Returns the findings on a rejected document rather than throwing. */
  saveComposition(input: CompositionInput, summary?: string): Promise<SaveResult<CompositionRecord>>
  deleteComposition(compositionId: string): Promise<void>
  compositionDeleteImpact(compositionId: string): Promise<DeleteImpact>
  listVersions(compositionId: string): Promise<CompositionVersionSummary[]>

  listPageTemplates(): Promise<PageTemplateRecord[]>
  savePageTemplate(input: PageTemplateInput): Promise<SaveResult<PageTemplateRecord>>
  deletePageTemplate(pageTemplateId: string): Promise<void>
  pageTemplateDeleteImpact(pageTemplateId: string): Promise<DeleteImpact>

  placementsForPage(pageTemplateId: string): Promise<PlacementRecord[]>
  setPlacement(input: PlacementInput): Promise<PlacementRecord[]>
  deletePlacement(key: PlacementKey): Promise<void>

  /** Validates without saving, against the same rules the agent is held to. */
  validate(a2ui: unknown, kind: 'composition' | 'page'): Promise<ValidationReport>
  importSamples(): Promise<SampleImportCounts>
}

/**
 * A rejected save is a normal outcome, not an exception: the Studio shows the
 * findings next to the JSON pane. Only transport and server faults throw.
 */
export type SaveResult<T> =
  | { ok: true; record: T; version?: number; warnings: ValidationFinding[] }
  | { ok: false; message: string; errors: ValidationFinding[]; warnings: ValidationFinding[] }

export interface SampleImportCounts {
  compositions: number
  pageTemplates: number
  placements: number
}
