import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { GripIcon } from '../icons'
import styles from './SplitDivider.module.css'

interface SplitDividerProps {
  onDrag: (clientX: number) => void
  onDragEnd: () => void
}

/**
 * The draggable line between the chat pane and the preview pane. Uses
 * pointer capture so the drag keeps tracking even when the cursor leaves
 * the thin divider element — no window-level listeners needed.
 */
export function SplitDivider({ onDrag, onDragEnd }: SplitDividerProps) {
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return
    onDrag(e.clientX)
  }

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
    onDragEnd()
  }

  return (
    <div
      className={`${styles.divider} ${dragging ? styles.dividerActive : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panes"
    >
      <div className={styles.track} />
      <div className={styles.grip}>
        <GripIcon size={14} />
      </div>
    </div>
  )
}
