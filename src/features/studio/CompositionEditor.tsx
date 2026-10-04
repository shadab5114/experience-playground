import { useMemo, useState } from 'react'
import { documentComponents } from '../../a2ui/documentFacts'
import { Button } from '../../components/Button'
import { Field } from '../../components/forms/Field'
import { Select } from '../../components/forms/Select'
import { TagInput } from '../../components/forms/TagInput'
import { TextArea } from '../../components/forms/TextArea'
import { TextInput } from '../../components/forms/TextInput'
import { JsonPanel, PreviewPanel, ValidationPanel } from './EditorPanels'
import { previewDocument, useLiveValidation } from './editorDocument'
import { useStudioStore, type CompositionEditorState } from './studioStore'
import styles from './CompositionEditor.module.css'

/** The sentinel the type select uses for "name a new one instead". */
const NEW_TYPE = '__new__'

export function CompositionEditor({ editor }: { editor: CompositionEditorState }) {
  const compositions = useStudioStore((s) => s.compositions)
  const editForm = useStudioStore((s) => s.editCompositionForm)
  useLiveValidation(editor)

  const [namingType, setNamingType] = useState(false)

  // Derived from the data, never a curated list: a type exists because a
  // composition uses it. The agent reads the same vocabulary from the same
  // column (CompositionStore.types), so a new one is never invisible to it.
  // The record's own type is included so an unsaved new one does not vanish.
  const knownTypes = useMemo(() => {
    const used = compositions.map((c) => c.type)
    return [...new Set([...used, editor.form.type].filter(Boolean))].sort()
  }, [compositions, editor.form.type])

  const showing = previewDocument(editor)
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
                value={editor.form.compositionId}
                disabled={!editor.isNew}
                placeholder="basic-plan-tile"
                onChange={(value) => editForm({ compositionId: value })}
              />
            )}
          </Field>

          <Field label="name" required>
            {({ id }) => (
              <TextInput id={id} value={editor.form.name} onChange={(value) => editForm({ name: value })} />
            )}
          </Field>

          <Field label="family" required hint="Groups the variants of one tile, e.g. “Basic Plan Tile”.">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                describedBy={describedBy}
                value={editor.form.family}
                onChange={(value) => editForm({ family: value })}
              />
            )}
          </Field>

          <Field label="type" required hint="What kind of thing this is. The agent uses it to find a tile's siblings.">
            {({ id, describedBy }) =>
              namingType ? (
                <div className={styles.inlineType}>
                  <TextInput
                    id={id}
                    describedBy={describedBy}
                    ariaLabel="New type"
                    value={editor.form.type}
                    placeholder="Compare Model"
                    onChange={(value) => editForm({ type: value })}
                  />
                  <Button small onClick={() => setNamingType(false)}>
                    Pick an existing type
                  </Button>
                </div>
              ) : (
                <Select
                  id={id}
                  describedBy={describedBy}
                  value={editor.form.type}
                  placeholder={knownTypes.length === 0 ? 'No types yet — name one' : undefined}
                  options={[
                    ...knownTypes.map((t) => ({ value: t, label: t })),
                    { value: NEW_TYPE, label: 'New type…' },
                  ]}
                  onChange={(value) => {
                    if (value === NEW_TYPE) {
                      setNamingType(true)
                      editForm({ type: '' })
                      return
                    }
                    editForm({ type: value })
                  }}
                />
              )
            }
          </Field>

          <Field label="tags">
            {({ id }) => (
              <TagInput
                id={id}
                value={editor.form.tags}
                placeholder="plan, mobile…"
                onChange={(value) => editForm({ tags: value })}
              />
            )}
          </Field>

          <Field label="description" required hint="helps the agent find this">
            {({ id, describedBy }) => (
              <TextArea
                id={id}
                describedBy={describedBy}
                rows={3}
                value={editor.form.description}
                placeholder="Mobile version of the basic plan: badge on top, price below…"
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
                placeholder="Never change the price text. Badge may only be red or neonYellow."
                onChange={(value) => editForm({ agentRules: value })}
              />
            )}
          </Field>
        </section>

        <JsonPanel editor={editor} />
      </div>

      <div className={styles.column}>
        <PreviewPanel editor={editor} />
        <ValidationPanel editor={editor} />

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

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Appears in</h2>
          {editor.appearsIn.length === 0 ? (
            <span className={styles.empty}>
              Not placed on any page yet. Mappings are built in the Mappings section.
            </span>
          ) : (
            <div className={styles.rows}>
              {editor.appearsIn.map((placement) => (
                <div key={`${placement.pageTemplateId}-${placement.slotId}`} className={styles.row}>
                  <span>
                    {placement.flowName} · {placement.slotId}
                  </span>
                  {placement.variant && <span className={styles.rowMuted}>{placement.variant}</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>History</h2>
          {editor.versions.length === 0 ? (
            <span className={styles.empty}>
              {editor.isNew ? 'Saving creates version 1.' : 'No saved versions yet.'}
            </span>
          ) : (
            <div className={styles.rows}>
              {editor.versions.map((version) => (
                <div key={version.version} className={styles.row}>
                  <span className={styles.rowKey}>v{version.version}</span>
                  <span>{version.savedAt.slice(0, 10)}</span>
                  <span className={styles.rowMuted}>
                    {version.savedBy ?? 'unknown'}
                    {version.summary ? ` · ${version.summary}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
