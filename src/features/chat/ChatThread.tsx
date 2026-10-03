import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../types/domain'
import { ChatMessageItem } from './ChatMessageItem'
import styles from './ChatThread.module.css'

export function ChatThread({ messages, onChip }: { messages: ChatMessage[]; onChip: (text: string) => void }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <span>Pick an experience to start a conversation.</span>
      </div>
    )
  }

  return (
    <div className={styles.thread}>
      {messages.map((message) => (
        <ChatMessageItem key={message.id} message={message} onChip={onChip} />
      ))}
      <div ref={endRef} />
    </div>
  )
}
