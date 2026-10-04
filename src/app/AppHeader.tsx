import { Text } from '@shadab5114/pds-core'
import { DATA_SOURCE } from '../services/config'
import { navigate, type Route } from './useHashRoute'
import styles from './AppHeader.module.css'

/**
 * The single top bar shown on every screen of the Experience Playground.
 * Per the UX spec: "Experience Playground · Powered by VDS (Verizon Design System)".
 *
 * In remote mode it also carries the Playground/Studio toggle. The Studio
 * writes straight to Postgres, so it has no mock equivalent and is hidden
 * rather than faked when DATA_SOURCE is 'mock'.
 */
export function AppHeader({ route }: { route: Route }) {
  return (
    <header className={styles.header}>
      <Text kind="title" size="small" bold primitive="h1">
        Experience Playground
      </Text>
      <Text kind="body" size="small" color="var(--pdesign-color-element-secondary-onlightprimary)">
        · Powered by <span className={styles.accent}>VDS</span> (Verizon Design System)
      </Text>

      {DATA_SOURCE === 'remote' && (
        <div className={styles.modeToggle} role="group" aria-label="App mode">
          <button
            type="button"
            className={`${styles.modeButton} ${route.mode === 'playground' ? styles.modeButtonActive : ''}`}
            aria-pressed={route.mode === 'playground'}
            onClick={() => navigate({ mode: 'playground' })}
          >
            Playground
          </button>
          <button
            type="button"
            className={`${styles.modeButton} ${route.mode === 'studio' ? styles.modeButtonActive : ''}`}
            aria-pressed={route.mode === 'studio'}
            onClick={() => navigate({ mode: 'studio', section: 'compositions' })}
          >
            Studio
          </button>
        </div>
      )}
    </header>
  )
}
