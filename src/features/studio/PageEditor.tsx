import { documentComponents, documentSlots } from '../../a2ui/documentFacts'
import { Field } from '../../components/forms/Field'
import { TextArea } from '../../components/forms/TextArea'
import { TextInput } from '../../components/forms/TextInput'
import { JsonPanel, PreviewPanel, ValidationPanel } from './EditorPanels'
import { previewDocument, useLiveValidation } from './editorDocument'
import { useStudioStore, type PageEditorState } from './studioStore'
import styles from './CompositionEditor.module.css'

export function PageEditor({ editor }: { editor: PageEditorState }) {
  const editForm = useStudioStore((s) => s.editPageForm)
  useLiveValidation(editor)

  const showing = previewDocument(editor)
  // Derived, never typed: a page's slots are its Slot nodes, so they cannot
  // drift from the document. The server derives the same list on save.
  const slots = showing ? documentSlots(showing) : []
  const components = showing ? documentComponents(showing) : []

  return (
    <div className={styles.editor}>
      <div className={styles.column}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Metadata</h2>

          <Field label="id" required hint="Lowercase letters, digits, '-' and '_'. Cannot be changed by renaming.">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                describedBy={describedBy}
                mono
                value={editor.form.pageTemplateId}
                disabled={!editor.isNew}
                placeholder="pdp-mock"
                onChange={(value) => editForm({ pageTemplateId: value })}
              />
            )}
          </Field>

          <Field label="name" required>
            {({ id }) => (
              <TextInput id={id} value={editor.form.name} onChange={(value) => editForm({ name: value })} />
            )}
          </Field>

          <Field label="description" hint="helps the agent understand what this page is for">
            {({ id, describedBy }) => (
              <TextArea
                id={id}
                describedBy={describedBy}
                rows={3}
                value={editor.form.description}
                placeholder="The product detail page, where the plan tile sits under the device intro."
                onChange={(value) => editForm({ description: value })}
              />
            )}
          </Field>

          <Field label="agent rules" hint="sent to the agent on edits — guidance, not a validator rule">
            {({ id, describedBy }) => (
              <TextArea
                id={id}
                describedBy={describedBy}
                rows={3}
                value={editor.form.agentRules}
                placeholder="Never move the plan slot above the device intro."
                onChange={(value) => editForm({ agentRules: value })}
              />
            )}
          </Field>
        </section>

        <JsonPanel editor={editor} />
      </div>

      <div className={styles.column}>
        <PreviewPanel editor={editor} wide />
        <ValidationPanel editor={editor} />

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Slots (derived)</h2>
          {slots.length === 0 ? (
            <span className={styles.empty}>
              No Slot nodes in this document. A page with no slot can host no composition.
            </span>
          ) : (
            <div className={styles.rows}>
              {slots.map((slot) => (
                <div key={slot} className={styles.row}>
                  <span className={styles.findingCode}>{slot}</span>
                </div>
              ))}
            </div>
          )}
          <span className={styles.hintLine}>
            Read-only: add or remove a <code>Slot</code> node in the document to change this list.
          </span>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Derived</h2>
          <div className={styles.facts}>
            <span className={styles.factKey}>components</span>
            <span className={styles.factValue}>{components.length > 0 ? components.join(', ') : '—'}</span>
            <span className={styles.factKey}>origin</span>
            <span className={styles.factValue}>
              {editor.origin ?? 'authored (not saved yet)'}
              {editor.origin === 'sample' && ' — re-importing samples can restore it after a delete'}
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}
