import { create } from 'zustand'
import type { StoreApi } from 'zustand'
import { A2UIDocumentSchema } from '@experience-agent/contract'
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
  RecordOrigin,
  ValidationFinding,
  ValidationReport,
} from '@experience-agent/contract'
import type { A2UIDocument } from '../../a2ui/types'
import type { Placement } from '../../types/domain'
import { services } from '../../services/createServices'
import { useTaskStore } from '../task/taskStore'
import { newCompositionDocument, newPageDocument } from './starterDocuments'

// Only this store talks to AuthoringRepository/Repository, the same rule the
// task store follows. Studio components read and write this store only.
const { authoring, repository } = services

/** The id a brand-new, unsaved record carries until it is first saved. */
export const NEW_RECORD = 'new'

/**
 * The in-flight list load, shared by every caller. A deep link
 * (#/studio/compositions/:id) opens a record while the Studio's own load is
 * still running, so `load()` has to return the running promise rather than bail
 * out — otherwise `openComposition` reads an empty list and reports the record
 * as missing.
 */
let loadInFlight: Promise<void> | null = null

function requireAuthoring() {
  if (!authoring) throw new Error('The Studio needs remote mode (VITE_DATA_SOURCE=remote)')
  return authoring
}

/** What both editors share: the document under edit and how it is going. */
interface EditorCore {
  isNew: boolean
  /** The id the record is stored under. `null` until a new record is first saved. */
  savedId: string | null
  /** Where the saved record came from; `null` until it has been saved once. */
  origin: RecordOrigin | null
  /** The A2UI document as text, because this is a paste-and-edit JSON editor. */
  json: string
  /**
   * The document the current text parses to, or `null` while the text is
   * broken. Validate and Save read this and nothing else: acting on anything
   * but what is on screen would save a document the person cannot see.
   */
  parsed: A2UIDocument | null
  /**
   * The last document that parsed. Used only by the preview, so a half-typed
   * edit does not blank the tile on every keystroke.
   */
  lastGood: A2UIDocument | null
  parseError: string | null
  report: ValidationReport | null
  validating: boolean
  saving: boolean
  /** A transport or contract failure, as opposed to validation findings. */
  saveError: string | null
  savedWarnings: ValidationFinding[]
  dirty: boolean
}

/** The metadata fields a person types for a composition. */
export interface CompositionForm {
  compositionId: string
  name: string
  family: string
  description: string
  agentRules: string
  type: string
  tags: string[]
}

/** The metadata fields a person types for a page template. `slots` is derived. */
export interface PageForm {
  pageTemplateId: string
  name: string
  description: string
  agentRules: string
}

export interface CompositionEditorState extends EditorCore {
  kind: 'composition'
  form: CompositionForm
  versions: CompositionVersionSummary[]
  appearsIn: Placement[]
}

export interface PageEditorState extends EditorCore {
  kind: 'page'
  form: PageForm
}

export type StudioEditor = CompositionEditorState | PageEditorState

/** Which record a confirm dialog is about, with the counts it has to name. */
export interface PendingDelete {
  kind: 'composition' | 'page'
  id: string
  impact: DeleteImpact
}

interface StudioStore {
  loaded: boolean
  loading: boolean
  error: string | null
  compositions: CompositionRecord[]
  pages: PageTemplateRecord[]
  /** At most one record is open at a time; the Studio is a single-pane editor. */
  editor: StudioEditor | null
  pendingDelete: PendingDelete | null
  /** The page the Mappings section is showing, and its placements. */
  mappingsPageId: string | null
  placements: PlacementRecord[]
  placementsBusy: boolean
  /** A short-lived confirmation line, e.g. "Saved as version 3". */
  notice: string | null

  load(force?: boolean): Promise<void>
  openComposition(compositionId: string): Promise<void>
  openPage(pageTemplateId: string): Promise<void>
  closeEditor(): void
  editCompositionForm(patch: Partial<CompositionForm>): void
  editPageForm(patch: Partial<PageForm>): void
  editJson(json: string): void
  formatJson(): void
  validateNow(): Promise<void>
  /** Returns the saved id on success, null otherwise. */
  save(): Promise<string | null>
  askDelete(kind: 'composition' | 'page', id: string): Promise<void>
  cancelDelete(): void
  confirmDelete(): Promise<void>
  /** Shows a page's mappings. Falls back to the first page when none is named. */
  selectMappingsPage(pageTemplateId?: string): Promise<void>
  setPlacement(input: PlacementInput): Promise<void>
  removePlacement(key: PlacementKey): Promise<void>
  importSamples(): Promise<void>
  clearNotice(): void
}

/** `type` defaults to one already in use; the editor lets a new one be named. */
const emptyCompositionForm = (type: string): CompositionForm => ({
  compositionId: '',
  name: '',
  family: '',
  description: '',
  agentRules: '',
  type,
  tags: [],
})

const emptyPageForm = (): PageForm => ({
  pageTemplateId: '',
  name: '',
  description: '',
  agentRules: '',
})

function compositionFormOf(record: CompositionRecord): CompositionForm {
  return {
    compositionId: record.compositionId,
    name: record.name,
    family: record.family,
    description: record.description,
    agentRules: record.agentRules ?? '',
    type: record.type,
    tags: record.tags,
  }
}

function pageFormOf(record: PageTemplateRecord): PageForm {
  return {
    pageTemplateId: record.pageTemplateId,
    name: record.name,
    description: record.description ?? '',
    agentRules: record.agentRules ?? '',
  }
}

/** The parts of a fresh editor that do not depend on which kind it is. */
function coreFor(document: A2UIDocument, record: { origin: RecordOrigin } | null): EditorCore {
  return {
    isNew: record === null,
    savedId: null,
    origin: record?.origin ?? null,
    json: JSON.stringify(document, null, 2),
    parsed: document,
    lastGood: document,
    parseError: null,
    report: null,
    validating: false,
    saving: false,
    saveError: null,
    savedWarnings: [],
    dirty: record === null,
  }
}

/** Parses editor text into a document, keeping the message a person can act on. */
function parseDocument(json: string): { parsed: A2UIDocument | null; parseError: string | null } {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (err) {
    return { parsed: null, parseError: (err as Error).message }
  }
  const result = A2UIDocumentSchema.safeParse(value)
  if (!result.success) {
    const first = result.error.issues[0]
    const where = first?.path.join('.') || 'document'
    return { parsed: null, parseError: `${where}: ${first?.message ?? 'does not match the A2UI envelope'}` }
  }
  return { parsed: result.data as A2UIDocument, parseError: null }
}

export const useStudioStore = create<StudioStore>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  compositions: [],
  pages: [],
  editor: null,
  pendingDelete: null,
  mappingsPageId: null,
  placements: [],
  placementsBusy: false,
  notice: null,

  async load(force = false) {
    if (loadInFlight) return loadInFlight
    if (get().loaded && !force) return
    set({ loading: true, error: null })
    loadInFlight = (async () => {
      try {
        const api = requireAuthoring()
        const [compositions, pages] = await Promise.all([api.listCompositions(), api.listPageTemplates()])
        set({ compositions, pages, loaded: true, loading: false })
      } catch (err) {
        set({ error: (err as Error).message, loading: false })
      } finally {
        loadInFlight = null
      }
    })()
    return loadInFlight
  },

  async openComposition(compositionId: string) {
    if (compositionId === NEW_RECORD) {
      await get().load()
      const [firstType] = [...new Set(get().compositions.map((c) => c.type))].sort()
      set({
        error: null,
        editor: {
          kind: 'composition',
          ...coreFor(newCompositionDocument(), null),
          form: emptyCompositionForm(firstType ?? ''),
          versions: [],
          appearsIn: [],
        },
      })
      void get().validateNow()
      return
    }

    await get().load()
    const record = get().compositions.find((c) => c.compositionId === compositionId)
    if (!record) {
      set({ editor: null, error: `No composition "${compositionId}"` })
      return
    }

    set({
      error: null,
      editor: {
        kind: 'composition',
        ...coreFor(record.a2ui, record),
        savedId: record.compositionId,
        form: compositionFormOf(record),
        versions: [],
        appearsIn: [],
      },
    })
    void get().validateNow()

    // History and "appears in" are side panels: a slow or failing load must not
    // keep the editor from opening.
    const [versions, mapping] = await Promise.all([
      requireAuthoring().listVersions(compositionId).catch(() => []),
      repository.getMapping(compositionId).catch(() => ({ compositionId, appearsIn: [] })),
    ])
    set((state) =>
      state.editor?.kind === 'composition' && state.editor.savedId === compositionId
        ? { editor: { ...state.editor, versions, appearsIn: mapping.appearsIn } }
        : state,
    )
  },

  async openPage(pageTemplateId: string) {
    await get().load()

    if (pageTemplateId === NEW_RECORD) {
      set({
        error: null,
        editor: { kind: 'page', ...coreFor(newPageDocument(), null), form: emptyPageForm() },
      })
      void get().validateNow()
      return
    }

    const record = get().pages.find((p) => p.pageTemplateId === pageTemplateId)
    if (!record) {
      set({ editor: null, error: `No page template "${pageTemplateId}"` })
      return
    }

    set({
      error: null,
      editor: {
        kind: 'page',
        ...coreFor(record.a2ui, record),
        savedId: record.pageTemplateId,
        form: pageFormOf(record),
      },
    })
    void get().validateNow()
  },

  // Only the editor. A pending delete is owned by the dialog, which the route
  // knows nothing about — clearing it here would dismiss the confirmation the
  // moment the list view mounted.
  closeEditor() {
    set({ editor: null })
  },

  editCompositionForm(patch) {
    set((state) =>
      state.editor?.kind === 'composition'
        ? { editor: { ...state.editor, form: { ...state.editor.form, ...patch }, dirty: true, saveError: null } }
        : state,
    )
  },

  editPageForm(patch) {
    set((state) =>
      state.editor?.kind === 'page'
        ? { editor: { ...state.editor, form: { ...state.editor.form, ...patch }, dirty: true, saveError: null } }
        : state,
    )
  },

  editJson(json) {
    set((state) => {
      if (!state.editor) return state
      const { parsed, parseError } = parseDocument(json)
      return {
        editor: {
          ...state.editor,
          json,
          parsed,
          parseError,
          // Only advances when the text parses, so the preview has something to show.
          lastGood: parsed ?? state.editor.lastGood,
          dirty: true,
          saveError: null,
        },
      }
    })
  },

  formatJson() {
    set((state) =>
      state.editor?.parsed
        ? { editor: { ...state.editor, json: JSON.stringify(state.editor.parsed, null, 2), parseError: null } }
        : state,
    )
  },

  async validateNow() {
    const editor = get().editor
    if (!editor) return
    if (!editor.parsed) {
      // Broken text is already reported as a parse error; don't ask the server.
      set((state) => (state.editor ? { editor: { ...state.editor, report: null, validating: false } } : state))
      return
    }
    const document = editor.parsed
    // "page" is the kind that lets Slot through; a composition may not contain one.
    const kind = editor.kind
    set((state) => (state.editor ? { editor: { ...state.editor, validating: true } } : state))
    try {
      const report = await requireAuthoring().validate(document, kind)
      set((state) =>
        // Only apply if the document has not changed since this call started.
        state.editor?.parsed === document ? { editor: { ...state.editor, report, validating: false } } : state,
      )
    } catch (err) {
      set((state) =>
        state.editor
          ? { editor: { ...state.editor, validating: false, saveError: `Validation failed: ${(err as Error).message}` } }
          : state,
      )
    }
  },

  async save() {
    const editor = get().editor
    if (!editor || editor.saving) return null
    if (!editor.parsed) {
      set((state) =>
        state.editor ? { editor: { ...state.editor, saveError: 'Fix the JSON before saving.' } } : state,
      )
      return null
    }

    // Captured here so the helpers cannot be handed anything but the document
    // that was on screen when Save was pressed.
    const document = editor.parsed
    set((state) => (state.editor ? { editor: { ...state.editor, saving: true, saveError: null } } : state))
    try {
      return editor.kind === 'composition'
        ? await saveComposition(editor, document, set)
        : await savePage(editor, document, set)
    } catch (err) {
      set((state) =>
        state.editor ? { editor: { ...state.editor, saving: false, saveError: (err as Error).message } } : state,
      )
      return null
    }
  },

  // Q2: a hard delete cascades, and cascading away version history cannot be
  // undone, so the counts are fetched before the dialog opens.
  async askDelete(kind, id) {
    try {
      const api = requireAuthoring()
      const impact =
        kind === 'composition' ? await api.compositionDeleteImpact(id) : await api.pageTemplateDeleteImpact(id)
      set({ pendingDelete: { kind, id, impact } })
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  cancelDelete() {
    set({ pendingDelete: null })
  },

  async confirmDelete() {
    const pending = get().pendingDelete
    if (!pending) return
    try {
      const api = requireAuthoring()
      if (pending.kind === 'composition') {
        await api.deleteComposition(pending.id)
        // The playground caches its picker list, so a delete has to mark it stale.
        useTaskStore.getState().invalidateExperiences()
      } else {
        await api.deletePageTemplate(pending.id)
      }
      set((state) => ({
        pendingDelete: null,
        notice: `Deleted ${pending.id}`,
        compositions:
          pending.kind === 'composition'
            ? state.compositions.filter((c) => c.compositionId !== pending.id)
            : state.compositions,
        pages: pending.kind === 'page' ? state.pages.filter((p) => p.pageTemplateId !== pending.id) : state.pages,
        editor: state.editor?.savedId === pending.id ? null : state.editor,
      }))
    } catch (err) {
      set({ pendingDelete: null, error: (err as Error).message })
    }
  },

  async selectMappingsPage(pageTemplateId?: string) {
    await get().load()
    const target = pageTemplateId ?? get().pages[0]?.pageTemplateId
    if (!target) {
      set({ mappingsPageId: null, placements: [] })
      return
    }
    set({ mappingsPageId: target, placementsBusy: true })
    try {
      const placements = await requireAuthoring().placementsForPage(target)
      set((state) => (state.mappingsPageId === target ? { placements, placementsBusy: false, error: null } : state))
    } catch (err) {
      set({ placementsBusy: false, error: (err as Error).message })
    }
  },

  async setPlacement(input: PlacementInput) {
    set({ placementsBusy: true })
    try {
      const placements = await requireAuthoring().setPlacement(input)
      set((state) =>
        state.mappingsPageId === input.pageTemplateId
          ? { placements, placementsBusy: false, error: null }
          : { placementsBusy: false },
      )
      await afterPlacementChange()
    } catch (err) {
      set({ placementsBusy: false, error: (err as Error).message })
    }
  },

  async removePlacement(key: PlacementKey) {
    set({ placementsBusy: true })
    try {
      const api = requireAuthoring()
      await api.deletePlacement(key)
      const placements = await api.placementsForPage(key.pageTemplateId)
      set((state) =>
        state.mappingsPageId === key.pageTemplateId
          ? { placements, placementsBusy: false, error: null }
          : { placementsBusy: false },
      )
      await afterPlacementChange()
    } catch (err) {
      set({ placementsBusy: false, error: (err as Error).message })
    }
  },

  async importSamples() {
    try {
      const counts = await requireAuthoring().importSamples()
      useTaskStore.getState().invalidateExperiences()
      const added = counts.compositions + counts.pageTemplates + counts.placements
      set({ notice: added === 0 ? 'Samples are already present; nothing added.' : `Imported ${added} sample rows.` })
      await get().load(true)
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  clearNotice() {
    set({ notice: null })
  },
}))

/**
 * A placement change moves a composition on or off a page, which is exactly what
 * the Impacts view renders — so the open task has to re-read its mapping or the
 * new tab only appears after reopening the task.
 */
async function afterPlacementChange(): Promise<void> {
  await useTaskStore.getState().reloadMapping()
}

/** The store's own setState, so the save helpers below can live outside the creator. */
type Set = StoreApi<StudioStore>['setState']

async function saveComposition(
  editor: CompositionEditorState,
  document: A2UIDocument,
  set: Set,
): Promise<string | null> {
  const input: CompositionInput = {
    compositionId: editor.form.compositionId.trim(),
    name: editor.form.name.trim(),
    family: editor.form.family.trim(),
    description: editor.form.description.trim(),
    ...(editor.form.agentRules.trim() ? { agentRules: editor.form.agentRules.trim() } : {}),
    type: editor.form.type.trim(),
    tags: editor.form.tags,
    a2ui: document,
  }

  const result = await requireAuthoring().saveComposition(input)
  if (!result.ok) {
    set((state) => (state.editor ? { editor: { ...state.editor, ...rejection(result) } } : state))
    return null
  }

  const record = result.record
  // The playground caches its picker list, so a save has to mark it stale.
  useTaskStore.getState().invalidateExperiences()
  const versions = await requireAuthoring().listVersions(record.compositionId).catch(() => [])
  set((state) => ({
    compositions: [...state.compositions.filter((r) => r.compositionId !== record.compositionId), record].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    notice: `Saved as version ${result.version ?? 1}`,
    editor:
      state.editor?.kind === 'composition'
        ? {
            ...state.editor,
            ...saved(record.a2ui, record.origin, record.compositionId, result.warnings),
            form: compositionFormOf(record),
            versions,
          }
        : state.editor,
  }))
  return record.compositionId
}

async function savePage(editor: PageEditorState, document: A2UIDocument, set: Set): Promise<string | null> {
  const input: PageTemplateInput = {
    pageTemplateId: editor.form.pageTemplateId.trim(),
    name: editor.form.name.trim(),
    ...(editor.form.description.trim() ? { description: editor.form.description.trim() } : {}),
    ...(editor.form.agentRules.trim() ? { agentRules: editor.form.agentRules.trim() } : {}),
    a2ui: document,
  }

  const result = await requireAuthoring().savePageTemplate(input)
  if (!result.ok) {
    set((state) => (state.editor ? { editor: { ...state.editor, ...rejection(result) } } : state))
    return null
  }

  const record = result.record
  set((state) => ({
    pages: [...state.pages.filter((p) => p.pageTemplateId !== record.pageTemplateId), record].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    notice: `Saved ${record.pageTemplateId}`,
    editor:
      state.editor?.kind === 'page'
        ? {
            ...state.editor,
            ...saved(record.a2ui, record.origin, record.pageTemplateId, result.warnings),
            form: pageFormOf(record),
          }
        : state.editor,
  }))
  return record.pageTemplateId
}

/** A rejected save: the findings become the validation report, nothing is marked saved. */
function rejection(result: { message: string; errors: ValidationFinding[]; warnings: ValidationFinding[] }) {
  return {
    saving: false,
    saveError: result.message,
    report: { errors: result.errors, warnings: result.warnings },
  }
}

/** What a successful save makes true, whichever kind of record it was. */
function saved(
  a2ui: A2UIDocument,
  origin: RecordOrigin,
  savedId: string,
  warnings: ValidationFinding[],
): Partial<EditorCore> {
  return {
    isNew: false,
    savedId,
    origin,
    json: JSON.stringify(a2ui, null, 2),
    parsed: a2ui,
    lastGood: a2ui,
    parseError: null,
    saving: false,
    saveError: null,
    savedWarnings: warnings,
    report: { errors: [], warnings },
    dirty: false,
  }
}
