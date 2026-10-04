import type { ValidationFinding } from '@experience-agent/contract'
import { A2UIRenderer } from '../../a2ui/renderer/A2UIRenderer'
import { Button } from '../../components/Button'
import { TextArea } from '../../components/forms/TextArea'
import { useStudioStore, type StudioEditor } from './studioStore'
import { previewDocument } from './editorDocument'
import styles from './CompositionEditor.module.css'

export function JsonPanel({ editor }: { editor: StudioEditor }) {
  const editJson = useStudioStore((s) => s.editJson)
  const formatJson = useStudioStore((s) => s.formatJson)

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>A2UI document</h2>
        <div className={styles.panelActions}>
          <Button small disabled={!editor.parsed} onClick={formatJson}>
            Format
          </Button>
        </div>
      </div>
      <TextArea
        mono
        spellCheck={false}
        ariaLabel="A2UI document"
        rows={18}
        value={editor.json}
        invalid={editor.parseError !== null}
        onChange={editJson}
      />
      {editor.parseError && (
        <span className={styles.staleNote} role="alert">
          {editor.parseError}
        </span>
      )}
      {editor.saveError && <div className={styles.saveError}>{editor.saveError}</div>}
    </section>
  )
}

export function PreviewPanel({ editor, wide }: { editor: StudioEditor; wide?: boolean }) {
  const showing = previewDocument(editor)
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Preview</h2>
      <div className={styles.stage}>
        <div className={wide ? styles.stageWide : styles.stageInner}>
          {showing ? <A2UIRenderer document={showing} /> : <span className={styles.empty}>Nothing to preview yet.</span>}
        </div>
      </div>
      {editor.parsed === null && showing !== null && (
        <span className={styles.staleNote}>Showing the last document that parsed.</span>
      )}
    </section>
  )
}

export function ValidationPanel({ editor }: { editor: StudioEditor }) {
  const validateNow = useStudioStore((s) => s.validateNow)
  const errors = editor.report?.errors ?? []
  const warnings = editor.report?.warnings ?? []

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Validation</h2>
        <div className={styles.panelActions}>
          <Button small onClick={() => void validateNow()} disabled={!editor.parsed || editor.validating}>
            {editor.validating ? 'Checking…' : 'Validate'}
          </Button>
        </div>
      </div>

      <div className={styles.counts}>
        {editor.report === null ? (
          <span className={styles.countMuted}>Not checked yet</span>
        ) : (
          <>
            <span className={errors.length === 0 ? styles.countOk : styles.countError}>
              ● {errors.length} {errors.length === 1 ? 'error' : 'errors'}
            </span>
            <span className={warnings.length === 0 ? styles.countMuted : styles.countWarning}>
              ▲ {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
            </span>
          </>
        )}
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <ul className={styles.findings}>
          {[...errors, ...warnings].map((finding, index) => (
            <FindingRow key={`${finding.code}-${finding.path}-${index}`} finding={finding} />
          ))}
        </ul>
      )}
    </section>
  )
}

function FindingRow({ finding }: { finding: ValidationFinding }) {
  const isError = finding.severity === 'error'
  return (
    <li className={`${styles.finding} ${isError ? styles.findingError : styles.findingWarning}`}>
      <span className={styles.findingMark} aria-hidden="true">
        {isError ? '●' : '▲'}
      </span>
      <span className={styles.findingBody}>
        <span className={styles.findingCode}>
          {finding.layer}/{finding.code}
        </span>{' '}
        <span className={styles.findingMessage}>{finding.message}</span>
        <br />
        <span className={styles.findingWhere}>
          {finding.componentId ? `${finding.componentId} → ` : ''}
          {finding.path}
        </span>
      </span>
    </li>
  )
}
