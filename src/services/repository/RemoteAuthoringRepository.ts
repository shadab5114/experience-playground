import {
  CompositionRecord,
  CompositionVersionSummary,
  DeleteImpact,
  FlowRecord,
  PageTemplateRecord,
  PlacementRecord,
  ValidationFinding,
  ValidationReport,
  type CompositionInput,
  type FlowInput,
  type PageTemplateInput,
  type PlacementInput,
  type PlacementKey,
} from '@experience-agent/contract'
import type { AuthoringRepository, SampleImportCounts, SaveResult } from './AuthoringRepository'

type Fetch = typeof fetch
interface Parser<T> {
  parse(input: unknown): T
}

const BASE = '/v1/authoring'

/**
 * Studio writes against the Experience Agent backend. Every response is checked
 * against the shared contract schemas, exactly as RemoteRepository does for reads.
 */
export class RemoteAuthoringRepository implements AuthoringRepository {
  private readonly baseUrl: string
  private readonly fetchImpl: Fetch

  // Wrapped so the browser calls fetch unbound; calling it as a method of this class throws "Illegal invocation".
  constructor(baseUrl: string, fetchImpl: Fetch = (input, init) => fetch(input, init)) {
    this.baseUrl = baseUrl
    this.fetchImpl = fetchImpl
  }

  listCompositions(): Promise<CompositionRecord[]> {
    return this.getJson(`${BASE}/compositions`, CompositionRecord.array())
  }

  saveComposition(input: CompositionInput, summary?: string): Promise<SaveResult<CompositionRecord>> {
    return this.put(
      `${BASE}/compositions/${encodeURIComponent(input.compositionId)}`,
      { ...input, ...(summary ? { summary } : {}) },
      CompositionRecord,
    )
  }

  async deleteComposition(compositionId: string): Promise<void> {
    await this.send('DELETE', `${BASE}/compositions/${encodeURIComponent(compositionId)}`)
  }

  compositionDeleteImpact(compositionId: string): Promise<DeleteImpact> {
    return this.getJson(`${BASE}/compositions/${encodeURIComponent(compositionId)}/delete-impact`, DeleteImpact)
  }

  listVersions(compositionId: string): Promise<CompositionVersionSummary[]> {
    return this.getJson(
      `${BASE}/compositions/${encodeURIComponent(compositionId)}/versions`,
      CompositionVersionSummary.array(),
    )
  }

  listPageTemplates(): Promise<PageTemplateRecord[]> {
    return this.getJson(`${BASE}/page-templates`, PageTemplateRecord.array())
  }

  savePageTemplate(input: PageTemplateInput): Promise<SaveResult<PageTemplateRecord>> {
    return this.put(`${BASE}/page-templates/${encodeURIComponent(input.pageTemplateId)}`, input, PageTemplateRecord)
  }

  async deletePageTemplate(pageTemplateId: string): Promise<void> {
    await this.send('DELETE', `${BASE}/page-templates/${encodeURIComponent(pageTemplateId)}`)
  }

  pageTemplateDeleteImpact(pageTemplateId: string): Promise<DeleteImpact> {
    return this.getJson(`${BASE}/page-templates/${encodeURIComponent(pageTemplateId)}/delete-impact`, DeleteImpact)
  }

  listFlows(): Promise<FlowRecord[]> {
    return this.getJson(`${BASE}/flows`, FlowRecord.array())
  }

  async saveFlow(input: FlowInput): Promise<FlowRecord> {
    const res = await this.send('PUT', `${BASE}/flows/${encodeURIComponent(input.flowId)}`, input)
    return FlowRecord.parse(await res.json())
  }

  async deleteFlow(flowId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}${BASE}/flows/${encodeURIComponent(flowId)}`, {
      method: 'DELETE',
    })
    // 409 means the flow still has pages — a refusal to show, not a crash.
    if (res.status === 409 || res.status === 404) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, message: payload.error ?? `Could not delete flow "${flowId}"` }
    }
    if (!res.ok) throw new Error(`DELETE ${BASE}/flows failed (${res.status})`)
    return { ok: true }
  }

  placementsForPage(pageTemplateId: string): Promise<PlacementRecord[]> {
    return this.getJson(
      `${BASE}/page-templates/${encodeURIComponent(pageTemplateId)}/placements`,
      PlacementRecord.array(),
    )
  }

  async setPlacement(input: PlacementInput): Promise<PlacementRecord[]> {
    const res = await this.send('PUT', `${BASE}/placements`, input)
    return PlacementRecord.array().parse(await res.json())
  }

  async deletePlacement(key: PlacementKey): Promise<void> {
    await this.send('DELETE', `${BASE}/placements`, key)
  }

  async validate(a2ui: unknown, kind: 'composition' | 'page'): Promise<ValidationReport> {
    const res = await this.send('POST', `${BASE}/validate`, { a2ui, kind })
    return ValidationReport.parse(await res.json())
  }

  async importSamples(): Promise<SampleImportCounts> {
    const res = await this.send('POST', `${BASE}/samples/import`)
    return (await res.json()) as SampleImportCounts
  }

  /**
   * A 422 carries the validator's findings and is an answer, not a failure —
   * the Studio renders it beside the document. Anything else throws.
   */
  private async put<T>(path: string, body: unknown, schema: Parser<T>): Promise<SaveResult<T>> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.status === 422) {
      const payload = (await res.json()) as { error?: string } & Partial<ValidationReport>
      return {
        ok: false,
        message: payload.error ?? 'The document does not validate',
        errors: ValidationFinding.array().parse(payload.errors ?? []),
        warnings: ValidationFinding.array().parse(payload.warnings ?? []),
      }
    }
    if (res.status === 400) {
      // A contract-level problem, which the form should have caught. Surfaced
      // as a message rather than a crash so a stale field cannot wedge the UI.
      // The Zod issues name the offending fields, which "Invalid composition"
      // on its own does not.
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        issues?: { path?: (string | number)[]; message?: string }[]
      }
      const fields = (payload.issues ?? [])
        .map((issue) => issue.path?.join('.'))
        .filter((path): path is string => Boolean(path))
      const detail = fields.length > 0 ? `: ${[...new Set(fields)].join(', ')}` : ''
      return {
        ok: false,
        message: `${payload.error ?? 'The server rejected this record'}${detail}`,
        errors: [],
        warnings: [],
      }
    }
    if (!res.ok) throw new Error(`PUT ${path} failed (${res.status})`)

    const payload = (await res.json()) as { record: unknown; version?: number; warnings?: unknown }
    return {
      ok: true,
      record: schema.parse(payload.record),
      ...(typeof payload.version === 'number' ? { version: payload.version } : {}),
      warnings: ValidationFinding.array().parse(payload.warnings ?? []),
    }
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (!res.ok) throw new Error(`${method} ${path} failed (${res.status})`)
    return res
  }

  private async getJson<T>(path: string, schema: Parser<T>): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path)
    if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`)
    return schema.parse(await res.json())
  }
}
