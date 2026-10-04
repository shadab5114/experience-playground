import { useEffect, useMemo, useState } from 'react'
import type { CompositionRecord, PageTemplateRecord, PlacementRecord } from '@experience-agent/contract'
import { A2UIRenderer } from '../../a2ui/renderer/A2UIRenderer'
import { SurfaceRegistryProvider } from '../../a2ui/renderer/SurfaceRegistry'
import type { SurfaceRegistry } from '../../a2ui/renderer/SurfaceRegistryContext'
import { pageSurfaceId, rekeySurface, slotSurfaceId } from '../../a2ui/rekeySurface'
import type { A2UIDocument } from '../../a2ui/types'
import { Button } from '../../components/Button'
import { Field } from '../../components/forms/Field'
import { Select } from '../../components/forms/Select'
import { TextInput } from '../../components/forms/TextInput'
import { useStudioStore } from './studioStore'
import styles from './MappingsSection.module.css'

const UNASSIGNED = ''

/**
 * Page-centric, because a page's slots are the constraint: a composition can
 * only go where a `Slot` node already exists. The preview reuses the Impacts
 * view's machinery exactly — rekey each document to its own surface and host
 * them independently (docs/decisions/impact-pages-slot-hosting.md), never merged.
 */
export function MappingsSection({ pageTemplateId }: { pageTemplateId?: string }) {
  const pages = useStudioStore((s) => s.pages)
  const flows = useStudioStore((s) => s.flows)
  const compositions = useStudioStore((s) => s.compositions)
  const mappingsPageId = useStudioStore((s) => s.mappingsPageId)
  const placements = useStudioStore((s) => s.placements)
  const busy = useStudioStore((s) => s.placementsBusy)
  const selectMappingsPage = useStudioStore((s) => s.selectMappingsPage)

  useEffect(() => {
    void selectMappingsPage(pageTemplateId)
  }, [pageTemplateId, selectMappingsPage])

  const page = pages.find((p) => p.pageTemplateId === mappingsPageId)

  // Only the lowest-position placement in a slot can render: a slot hosts one
  // surface. Built here so the preview and the warning below agree.
  const shownPerSlot = useMemo(() => {
    const bySlot = new Map<string, PlacementRecord>()
    for (const placement of [...placements].sort((a, b) => a.position - b.position)) {
      if (!bySlot.has(placement.slotId)) bySlot.set(placement.slotId, placement)
    }
    return bySlot
  }, [placements])

  const registry: SurfaceRegistry = useMemo(() => {
    const map = new Map<string, A2UIDocument>()
    if (!page) return map
    const pageId = page.pageTemplateId
    map.set(pageSurfaceId(pageId), { meta: page.a2ui.meta, a2ui: rekeySurface(page.a2ui.a2ui, pageSurfaceId(pageId)) })
    for (const [slotId, placement] of shownPerSlot) {
      const composition = compositions.find((c) => c.compositionId === placement.compositionId)
      if (!composition) continue
      map.set(slotSurfaceId(pageId, slotId), {
        meta: composition.a2ui.meta,
        a2ui: rekeySurface(composition.a2ui.a2ui, slotSurfaceId(pageId, slotId)),
      })
    }
    return map
  }, [page, shownPerSlot, compositions])

  if (pages.length === 0) {
    return (
      <div className={styles.empty}>
        No page templates yet. A mapping puts a composition into a page's slot, so there has to be a page first.
      </div>
    )
  }

  return (
    <div className={styles.mappings}>
      <div className={styles.pageBar}>
        <Field label="page">
          {({ id }) => (
            <Select
              id={id}
              value={mappingsPageId ?? ''}
              options={pages.map((p) => ({ value: p.pageTemplateId, label: `${p.name} (${p.pageTemplateId})` }))}
              onChange={(value) => void selectMappingsPage(value)}
            />
          )}
        </Field>
        {page && (
          <span className={styles.flowNote}>
            Flow: {flows.find((f) => f.flowId === page.flowId)?.name ?? page.flowId}
          </span>
        )}
      </div>

      {page && page.slots.length === 0 && (
        <div className={styles.empty}>
          This page declares no <code>Slot</code> nodes, so nothing can be placed in it. Add one in the page editor.
        </div>
      )}

      {page && page.slots.length > 0 && (
        <div className={styles.table}>
          <div className={`${styles.row} ${styles.headRow}`}>
            <span>Slot</span>
            <span>Composition</span>
            <span>Variant</span>
            <span>Pos</span>
            <span />
          </div>
          {page.slots.map((slotId) => (
            <SlotRows
              key={slotId}
              slotId={slotId}
              page={page}
              compositions={compositions}
              placements={placements.filter((p) => p.slotId === slotId).sort((a, b) => a.position - b.position)}
              busy={busy}
            />
          ))}
        </div>
      )}

      {page && (
        <section className={styles.previewPanel}>
          <h2 className={styles.previewTitle}>Preview — the page with its assigned compositions</h2>
          <div className={styles.previewStage}>
            <SurfaceRegistryProvider registry={registry}>
              <A2UIRenderer surfaceId={pageSurfaceId(page.pageTemplateId)} />
            </SurfaceRegistryProvider>
          </div>
        </section>
      )}
    </div>
  )
}

function SlotRows({
  slotId,
  page,
  compositions,
  placements,
  busy,
}: {
  slotId: string
  page: PageTemplateRecord
  compositions: CompositionRecord[]
  placements: PlacementRecord[]
  busy: boolean
}) {
  const setPlacement = useStudioStore((s) => s.setPlacement)
  const removePlacement = useStudioStore((s) => s.removePlacement)

  const options = [
    { value: UNASSIGNED, label: '— unassigned —' },
    ...compositions.map((c) => ({ value: c.compositionId, label: c.name })),
  ]

  const assign = async (compositionId: string, replacing?: PlacementRecord) => {
    if (compositionId === UNASSIGNED) {
      if (replacing) await removePlacement(replacing)
      return
    }
    // The primary key includes the composition, so changing which composition
    // sits in a slot is a remove plus an add, not an update.
    if (replacing && replacing.compositionId !== compositionId) {
      await removePlacement(replacing)
    }
    await setPlacement({
      compositionId,
      pageTemplateId: page.pageTemplateId,
      slotId,
      ...(replacing?.variant ? { variant: replacing.variant } : {}),
      position: replacing?.position ?? placements.length,
    })
  }

  return (
    <>
      {placements.map((placement, index) => (
        <div key={placement.compositionId} className={styles.row}>
          <span className={styles.slotId}>{index === 0 ? slotId : ''}</span>
          <Select
            ariaLabel={`Composition in ${slotId}`}
            value={placement.compositionId}
            options={options}
            disabled={busy}
            onChange={(value) => void assign(value, placement)}
          />
          {/* Keyed on the stored value so a server-side change remounts the
              field with fresh initial state, instead of syncing it in an effect. */}
          <VariantField key={`v:${placement.variant ?? ''}`} placement={placement} disabled={busy} />
          <PositionField key={`p:${placement.position}`} placement={placement} disabled={busy} />
          <Button small variant="danger" disabled={busy} onClick={() => void removePlacement(placement)}>
            Remove
          </Button>
        </div>
      ))}

      {placements.length === 0 && (
        <div className={styles.row}>
          <span className={styles.slotId}>{slotId}</span>
          <Select
            ariaLabel={`Composition in ${slotId}`}
            value={UNASSIGNED}
            options={options}
            disabled={busy}
            onChange={(value) => void assign(value)}
          />
          <span />
          <span />
          <span />
        </div>
      )}

      {placements.length > 1 && (
        <div className={styles.slotWarning}>
          A slot hosts one surface, so only <strong>{placements[0]?.compositionId}</strong> (lowest position) renders
          here. The others are stored but invisible.
        </div>
      )}
    </>
  )
}

/** Saved on blur, so typing a variant does not fire a request per keystroke. */
function VariantField({ placement, disabled }: { placement: PlacementRecord; disabled: boolean }) {
  const setPlacement = useStudioStore((s) => s.setPlacement)
  const [draft, setDraft] = useState(placement.variant ?? '')

  const commit = () => {
    const variant = draft.trim()
    if (variant === (placement.variant ?? '')) return
    void setPlacement({ ...placement, ...(variant ? { variant } : {}) })
  }

  return (
    <span onBlur={commit}>
      <TextInput
        ariaLabel={`Variant for ${placement.compositionId} in ${placement.slotId}`}
        value={draft}
        disabled={disabled}
        placeholder="—"
        onChange={setDraft}
      />
    </span>
  )
}

function PositionField({ placement, disabled }: { placement: PlacementRecord; disabled: boolean }) {
  const setPlacement = useStudioStore((s) => s.setPlacement)
  const [draft, setDraft] = useState(String(placement.position))

  const commit = () => {
    const position = Number(draft)
    if (!Number.isInteger(position) || position < 0 || position === placement.position) {
      setDraft(String(placement.position))
      return
    }
    void setPlacement({ ...placement, position })
  }

  return (
    <span onBlur={commit}>
      <TextInput
        ariaLabel={`Position for ${placement.compositionId} in ${placement.slotId}`}
        value={draft}
        disabled={disabled}
        onChange={setDraft}
      />
    </span>
  )
}
