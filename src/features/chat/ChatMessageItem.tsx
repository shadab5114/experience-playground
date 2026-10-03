import type { ChatMessage } from '../../types/domain'
import styles from './ChatMessageItem.module.css'

export function ChatMessageItem({ message, onChip }: { message: ChatMessage; onChip: (text: string) => void }) {
  switch (message.kind) {
    case 'user':
      return (
        <div className={`${styles.row} ${styles.rowUser}`}>
          <div className={`${styles.bubble} ${styles.bubbleUser}`}>{message.text}</div>
        </div>
      )

    case 'agent':
      return (
        <div className={`${styles.row} ${styles.rowAgent}`}>
          <div className={`${styles.bubble} ${styles.bubbleAgent}`}>{message.text}</div>
        </div>
      )

    case 'status':
      return (
        <div className={styles.statusSteps}>
          {message.steps.map((step) => (
            <div key={step.id} className={`${styles.statusStep} ${step.state === 'done' ? styles.statusStepDone : ''}`}>
              {step.state === 'running' ? <span className={styles.spinner} aria-hidden /> : <span className={styles.check}>✓</span>}
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      )

    case 'result':
      return (
        <div className={styles.result}>
          <span className={styles.resultBadge}>v{message.version}</span>
          <span>{message.summary} — not saved yet</span>
        </div>
      )

    case 'refusal':
      return (
        <div className={`${styles.card} ${styles.cardRefusal}`}>
          <div>{message.reason}</div>
          {message.alternatives.length > 0 && (
            <div className={styles.chips}>
              {message.alternatives.map((alt) => (
                <button key={alt} type="button" className={styles.chip} onClick={() => onChip(alt)}>
                  {alt}
                </button>
              ))}
            </div>
          )}
        </div>
      )

    case 'scope':
      return (
        <div className={`${styles.card} ${styles.cardScope}`}>
          <div>{message.text}</div>
        </div>
      )

    case 'system':
      return <div className={styles.system}>{message.text}</div>

    case 'error':
      return (
        <div className={`${styles.card} ${styles.cardError}`}>
          <div>{message.text}</div>
          {message.retryPrompt && (
            <div className={styles.chips}>
              <button type="button" className={styles.chip} onClick={() => onChip(message.retryPrompt!)}>
                Retry
              </button>
            </div>
          )}
        </div>
      )
  }
}
