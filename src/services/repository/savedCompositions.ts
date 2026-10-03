import type { SavedComposition } from '../../types/domain'

// Saved versions stay in the browser for now, in both mock and remote mode.
// The backend's composition_versions table is ready for server saves later.
const SAVE_KEY_PREFIX = 'experience-playground:saved:'

export async function readSavedComposition(compositionId: string): Promise<SavedComposition | null> {
  try {
    const raw = localStorage.getItem(SAVE_KEY_PREFIX + compositionId)
    return raw ? (JSON.parse(raw) as SavedComposition) : null
  } catch {
    return null
  }
}

export async function writeSavedComposition(saved: SavedComposition): Promise<void> {
  localStorage.setItem(SAVE_KEY_PREFIX + saved.compositionId, JSON.stringify(saved))
}
