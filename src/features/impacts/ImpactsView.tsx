import { useMemo } from 'react'
import { A2UIRenderer } from '../../a2ui/renderer/A2UIRenderer'
import { SurfaceRegistryProvider } from '../../a2ui/renderer/SurfaceRegistry'
import type { SurfaceRegistry } from '../../a2ui/renderer/SurfaceRegistryContext'
import { pageSurfaceId, rekeySurface, slotSurfaceId } from '../../a2ui/rekeySurface'
import type { A2UIDocument } from '../../a2ui/types'
import { getCurrentVersion, useTaskStore } from '../task/taskStore'
import styles from './ImpactsView.module.css'

/**
 * Tabs per mapped page (docs/PLAN.md "Impacts view"), each a mock of the
 * real page with the current version placed in its own slot. Pages and the
 * composition are hosted as fully independent A2UI surfaces — see
 * docs/decisions/impact-pages-slot-hosting.md — never merged, so this view
 * is "render only": it just rekeys and registers documents, nothing more.
 */
export function ImpactsView() {
  const task = useTaskStore((s) => s.task)
  const mapping = useTaskStore((s) => s.mapping)
  const pageTemplatesById = useTaskStore((s) => s.pageTemplatesById)
  const setImpactTab = useTaskStore((s) => s.setImpactTab)

  const version = task ? getCurrentVersion(task) : null

  // Rebuilds whenever the current version changes, so every mapped page's
  // slot updates in place — the active tab never has to change for this.
  const registry: SurfaceRegistry = useMemo(() => {
    const map = new Map<string, A2UIDocument>()
    if (!mapping || !version) return map
    for (const placement of mapping.appearsIn) {
      const page = pageTemplatesById[placement.pageTemplateId]
      if (!page) continue
      map.set(pageSurfaceId(placement.pageTemplateId), {
        meta: page.a2ui.meta,
        a2ui: rekeySurface(page.a2ui.a2ui, pageSurfaceId(placement.pageTemplateId)),
      })
      map.set(slotSurfaceId(placement.pageTemplateId, placement.slotId), {
        meta: version.a2ui.meta,
        a2ui: rekeySurface(version.a2ui.a2ui, slotSurfaceId(placement.pageTemplateId, placement.slotId)),
      })
    }
    return map
  }, [mapping, pageTemplatesById, version])

  if (!task || !mapping || mapping.appearsIn.length === 0) {
    return <div className={styles.empty}>This experience isn't mapped to any pages yet.</div>
  }

  // Keyed by page, not by any grouping above it: a composition can appear on
  // several pages and each needs its own reachable tab.
  const activePageId = task.view.impactTab ?? mapping.appearsIn[0].pageTemplateId
  const activePlacement = mapping.appearsIn.find((p) => p.pageTemplateId === activePageId) ?? mapping.appearsIn[0]
  const pageReady = Boolean(pageTemplatesById[activePlacement.pageTemplateId])
  const isMobile = task.view.device === 'mobile'
  const variantClass = activePlacement.variant ? styles[`variant${capitalize(activePlacement.variant)}`] : ''

  return (
    <div className={styles.stage}>
      <div className={styles.tabs} role="tablist">
        {mapping.appearsIn.map((placement) => (
          <button
            key={`${placement.pageTemplateId}:${placement.slotId}`}
            type="button"
            role="tab"
            aria-selected={placement.pageTemplateId === activePageId}
            className={placement.pageTemplateId === activePageId ? styles.tabActive : styles.tab}
            onClick={() => setImpactTab(placement.pageTemplateId)}
          >
            {placement.pageName}
          </button>
        ))}
      </div>

      <div className={`${styles.pageStage} ${isMobile ? styles.pageStageMobile : ''} ${variantClass}`}>
        <div className={styles.pageInner}>
          {pageReady ? (
            <SurfaceRegistryProvider registry={registry}>
              <A2UIRenderer surfaceId={pageSurfaceId(activePlacement.pageTemplateId)} />
            </SurfaceRegistryProvider>
          ) : (
            <span>Loading…</span>
          )}
        </div>
      </div>
    </div>
  )
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
