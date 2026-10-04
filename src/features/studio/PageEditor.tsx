import { useState } from 'react'
import { documentComponents, documentSlots } from '../../a2ui/documentFacts'
import { Button } from '../../components/Button'
import { Field } from '../../components/forms/Field'
import { Select } from '../../components/forms/Select'
import { TextArea } from '../../components/forms/TextArea'
import { TextInput } from '../../components/forms/TextInput'
import { JsonPanel, PreviewPanel, ValidationPanel } from './EditorPanels'
import { previewDocument, useLiveValidation } from './editorDocument'
import { useStudioStore, type PageEditorState } from './studioStore'
import styles from './CompositionEditor.module.css'

/** The sentinel value the flow select uses for "create one instead". */
const NEW_FLOW = '__new__'

export function PageEditor({ editor }: { editor: PageEditorState }) {
  const flows = useStudioStore((s) => s.flows)
  const editForm = useStudioStore((s) => s.editPageForm)
  useLiveValidation(editor)

  const [creatingFlow, setCreatingFlow] = useState(false)

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

          <Field label="flow" required hint="Every page belongs to a flow; the Impacts view groups tabs by it.">
            {({ id, describedBy }) => (
              <Select
                id={id}
                describedBy={describedBy}
                value={creatingFlow ? NEW_FLOW : editor.form.flowId}
                placeholder={flows.length === 0 ? 'No flows yet — create one' : undefined}
                options={[
                  ...flows.map((flow) => ({ value: flow.flowId, label: `${flow.name} (${flow.flowId})` })),
                  { value: NEW_FLOW, label: 'New flow…' },
                ]}
                onChange={(value) => {
                  if (value === NEW_FLOW) {
                    setCreatingFlow(true)
                    return
                  }
                  setCreatingFlow(false)
                  editForm({ flowId: value })
                }}
              />
            )}
          </Field>

          {creatingFlow && (
            <NewFlowRow
              onCancel={() => setCreatingFlow(false)}
              onCreated={(flowId) => {
                editForm({ flowId })
                setCreatingFlow(false)
              }}
            />
          )}

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

/** Creates a flow without leaving the page form, since a page cannot be saved without one. */
function NewFlowRow({ onCancel, onCreated }: { onCancel: () => void; onCreated: (flowId: string) => void }) {
  const saveFlow = useStudioStore((s) => s.saveFlow)
  const [flowId, setFlowId] = useState('')
  const [name, setName] = useState('')

  const create = async () => {
    if (!flowId.trim() || !name.trim()) return
    if (await saveFlow(flowId, name)) onCreated(flowId.trim())
  }

  return (
    <div className={styles.inlineForm}>
      <Field label="new flow id" required>
        {({ id }) => <TextInput id={id} mono value={flowId} placeholder="checkout" onChange={setFlowId} />}
      </Field>
      <Field label="new flow name" required>
        {({ id }) => <TextInput id={id} value={name} placeholder="Checkout" onChange={setName} />}
      </Field>
      <div className={styles.inlineActions}>
        <Button small onClick={onCancel}>
          Cancel
        </Button>
        <Button small variant="primary" disabled={!flowId.trim() || !name.trim()} onClick={() => void create()}>
          Create flow
        </Button>
      </div>
    </div>
  )
}
