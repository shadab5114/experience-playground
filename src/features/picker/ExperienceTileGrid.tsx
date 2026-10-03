import type { Experience } from '../../types/domain'
import styles from './ExperienceTileGrid.module.css'

export function ExperienceTileGrid({ experiences, onPick }: { experiences: Experience[]; onPick: (id: string) => void }) {
  return (
    <div className={styles.grid}>
      {experiences.length === 0 && <div className={styles.empty}>No experiences match.</div>}
      {experiences.map((experience) => (
        <button key={experience.id} type="button" className={styles.tile} onClick={() => onPick(experience.id)}>
          {experience.name}
          {experience.description && <span className={styles.tileDescription}>{experience.description}</span>}
        </button>
      ))}
    </div>
  )
}
