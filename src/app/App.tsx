import { useCallback, useRef, useState } from 'react'
import { AppHeader } from './AppHeader'
import { LeftPane } from './LeftPane'
import { SplitDivider } from './SplitDivider'
import { PreviewPane } from '../features/preview/PreviewPane'
import { StudioView } from '../features/studio/StudioView'
import { useHashRoute } from './useHashRoute'
import styles from './App.module.css'

const MIN_LEFT_PCT = 25
const MAX_LEFT_PCT = 70
const DEFAULT_LEFT_PCT = 40
const SPLIT_STORAGE_KEY = 'experience-playground:split-width'

function clamp(pct: number): number {
  return Math.min(MAX_LEFT_PCT, Math.max(MIN_LEFT_PCT, pct))
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY)
    const value = raw ? Number(raw) : NaN
    return Number.isFinite(value) ? clamp(value) : DEFAULT_LEFT_PCT
  } catch {
    return DEFAULT_LEFT_PCT
  }
}

export function App() {
  const route = useHashRoute()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [leftWidthPct, setLeftWidthPct] = useState(readStoredWidth)
  const widthRef = useRef(leftWidthPct)

  const handleDrag = useCallback((clientX: number) => {
    const container = bodyRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const pct = clamp(((clientX - rect.left) / rect.width) * 100)
    widthRef.current = pct
    setLeftWidthPct(pct)
  }, [])

  const handleDragEnd = useCallback(() => {
    try {
      localStorage.setItem(SPLIT_STORAGE_KEY, String(widthRef.current))
    } catch {
      // Per-viewer convenience only; fine to lose silently.
    }
  }, [])

  return (
    <div className={styles.shell}>
      <AppHeader route={route} />
      {route.mode === 'studio' ? (
        <div className={styles.body}>
          <StudioView section={route.section} {...(route.id ? { id: route.id } : {})} />
        </div>
      ) : (
        <div className={styles.body} ref={bodyRef}>
          <LeftPane widthPercent={leftWidthPct} />
          <SplitDivider onDrag={handleDrag} onDragEnd={handleDragEnd} />
          <PreviewPane />
        </div>
      )}
    </div>
  )
}
