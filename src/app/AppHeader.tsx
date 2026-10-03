import { Text } from '@shadab5114/pds-core'
import styles from './AppHeader.module.css'

/**
 * The single top bar shown on every screen of the Experience Playground.
 * Per the UX spec: "Experience Playground · Powered by VDS (Verizon Design System)".
 */
export function AppHeader() {
  return (
    <header className={styles.header}>
      <Text kind="title" size="small" bold primitive="h1">
        Experience Playground
      </Text>
      <Text kind="body" size="small" color="var(--pdesign-color-element-secondary-onlightprimary)">
        · Powered by <span className={styles.accent}>VDS</span> (Verizon Design System)
      </Text>
    </header>
  )
}
