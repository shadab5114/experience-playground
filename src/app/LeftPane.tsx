import { useMemo, useState } from 'react'
import { useTaskStore } from '../features/task/taskStore'
import { ExperienceTileGrid } from '../features/picker/ExperienceTileGrid'
import { ChatThread } from '../features/chat/ChatThread'
import { ChatInput } from '../features/chat/ChatInput'
import { IconButton } from '../components/IconButton'
import { Close, Search } from '../icons'
import styles from './LeftPane.module.css'

/**
 * Left pane: experience picker + chat thread + input. Per the UX spec, the
 * same input box doubles as the pre-pick search field and the post-pick
 * prompt box.
 */
export function LeftPane({ widthPercent }: { widthPercent: number }) {
  const experiences = useTaskStore((s) => s.experiences)
  const task = useTaskStore((s) => s.task)
  const pickExperience = useTaskStore((s) => s.pickExperience)
  const closeTask = useTaskStore((s) => s.closeTask)
  const sendPrompt = useTaskStore((s) => s.sendPrompt)

  const [pickerOpen, setPickerOpen] = useState(!task)
  const [inputValue, setInputValue] = useState('')

  const filteredExperiences = useMemo(() => {
    const q = inputValue.trim().toLowerCase()
    if (!q) return experiences
    return experiences.filter((e) => e.name.toLowerCase().includes(q))
  }, [experiences, inputValue])

  const showGrid = !task && (pickerOpen || inputValue.trim().length > 0)

  const handlePick = async (id: string) => {
    await pickExperience(id)
    setPickerOpen(false)
    setInputValue('')
  }

  const handleSubmit = async (value: string) => {
    if (task) {
      setInputValue('')
      await sendPrompt(value)
      return
    }
    // Search mode: Enter with exactly one match picks it.
    const matches = experiences.filter((e) => e.name.toLowerCase().includes(value.toLowerCase()))
    if (matches.length === 1) {
      await handlePick(matches[0].id)
    }
  }

  const placeholder = task ? 'Describe a change…' : 'Start by choosing an experience or type to search by experience name'

  return (
    <div className={styles.pane} style={{ width: `${widthPercent}%` }}>
      <div className={styles.header}>
        <button type="button" className={styles.pickButton} onClick={() => setPickerOpen((v) => !v)}>
          <Search size={14} />
          Pick an experience
        </button>
        {task && (
          <div className={styles.experienceChip}>
            <span>{task.experienceName}</span>
            <IconButton icon={<Close size={14} />} label="Close task" onClick={closeTask} />
          </div>
        )}
      </div>

      {showGrid && <ExperienceTileGrid experiences={filteredExperiences} onPick={(id) => void handlePick(id)} />}

      <ChatThread messages={task?.messages ?? []} onChip={(text) => void sendPrompt(text)} />

      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSubmit={(v) => void handleSubmit(v)}
        disabled={task?.agentStatus === 'working'}
        placeholder={placeholder}
      />
    </div>
  )
}
