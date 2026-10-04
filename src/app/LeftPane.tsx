import { useEffect, useMemo, useState } from 'react'
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
  const loadExperiences = useTaskStore((s) => s.loadExperiences)
  const task = useTaskStore((s) => s.task)
  const draft = useTaskStore((s) => s.draft)
  const pickExperience = useTaskStore((s) => s.pickExperience)
  const closeTask = useTaskStore((s) => s.closeTask)
  const sendPrompt = useTaskStore((s) => s.sendPrompt)
  const sendChatFirstPrompt = useTaskStore((s) => s.sendChatFirstPrompt)

  // Here rather than in App: the pane remounts when the Studio hands the
  // screen back, which is exactly when a freshly authored tile has to appear.
  useEffect(() => {
    void loadExperiences()
  }, [loadExperiences])

  const [pickerOpen, setPickerOpen] = useState(!task)
  const [inputValue, setInputValue] = useState('')

  const filteredExperiences = useMemo(() => {
    const q = inputValue.trim().toLowerCase()
    if (!q) return experiences
    return experiences.filter((e) => e.name.toLowerCase().includes(q))
  }, [experiences, inputValue])

  // While a chat is open the grid is hidden. Typed text shows the grid only when it matches a name.
  const showGrid = !task && !draft && (inputValue.trim() === '' ? pickerOpen : filteredExperiences.length > 0)

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
    // Shortcut: Enter with exactly one name match picks it. Anything else is a request to the agent.
    const matches = experiences.filter((e) => e.name.toLowerCase().includes(value.toLowerCase()))
    if (matches.length === 1) {
      await handlePick(matches[0].id)
      return
    }
    setInputValue('')
    await sendChatFirstPrompt(value)
  }

  const placeholder = task
    ? 'Describe a change…'
    : draft
      ? 'Ask for a tile, for example "show me home plan"…'
      : 'Pick an experience, or type what you want to see, for example "show me home plan"'

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

      <ChatThread messages={task?.messages ?? draft?.messages ?? []} onChip={(text) => void (task ? sendPrompt(text) : sendChatFirstPrompt(text))} />

      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSubmit={(v) => void handleSubmit(v)}
        disabled={task?.agentStatus === 'working' || draft?.agentStatus === 'working'}
        placeholder={placeholder}
      />
    </div>
  )
}
