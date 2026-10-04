import { useState } from 'react'
import { Button } from '../../components/Button'
import { Field } from '../../components/forms/Field'
import { TextInput } from '../../components/forms/TextInput'
import { useStudioStore } from './studioStore'
import styles from './StudioView.module.css'

/**
 * Flows exist so pages can belong to one; the Impacts view groups its tabs by
 * flow. A flow can be created, renamed and — only while nothing uses it —
 * removed: `page_templates.flow_id` is a NOT NULL foreign key with no cascade,
 * so deleting a flow with pages would orphan them. The server refuses it too.
 */
export function FlowsSection() {
  const flows = useStudioStore((s) => s.flows)
  const pages = useStudioStore((s) => s.pages)
  const saveFlow = useStudioStore((s) => s.saveFlow)

  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')

  const create = async () => {
    if (await saveFlow(newId, newName)) {
      setNewId('')
      setNewName('')
    }
  }

  return (
    <div className={styles.list}>
      {flows.map((flow) => (
        <FlowRow key={flow.flowId} flowId={flow.flowId} name={flow.name} pages={pages.filter((p) => p.flowId === flow.flowId).length} />
      ))}

      <div className={styles.inlineCreate}>
        <Field label="new flow id" required>
          {({ id }) => <TextInput id={id} mono value={newId} placeholder="checkout" onChange={setNewId} />}
        </Field>
        <Field label="name" required>
          {({ id }) => <TextInput id={id} value={newName} placeholder="Checkout" onChange={setNewName} />}
        </Field>
        <Button variant="primary" disabled={!newId.trim() || !newName.trim()} onClick={() => void create()}>
          Add flow
        </Button>
      </div>
    </div>
  )
}

function FlowRow({ flowId, name, pages }: { flowId: string; name: string; pages: number }) {
  const saveFlow = useStudioStore((s) => s.saveFlow)
  const deleteFlow = useStudioStore((s) => s.deleteFlow)
  const [draft, setDraft] = useState(name)
  const changed = draft.trim() !== name && draft.trim() !== ''

  return (
    <div className={styles.flowRow}>
      <span className={styles.flowId}>{flowId}</span>
      <div className={styles.flowName}>
        <TextInput value={draft} ariaLabel={`Name for flow ${flowId}`} onChange={setDraft} />
      </div>
      <span className={styles.chip}>
        {pages} {pages === 1 ? 'page' : 'pages'}
      </span>
      <Button small disabled={!changed} onClick={() => void saveFlow(flowId, draft)}>
        Rename
      </Button>
      <Button
        small
        variant="danger"
        disabled={pages > 0}
        title={pages > 0 ? 'A flow with pages cannot be removed' : undefined}
        onClick={() => void deleteFlow(flowId)}
      >
        Remove
      </Button>
    </div>
  )
}
