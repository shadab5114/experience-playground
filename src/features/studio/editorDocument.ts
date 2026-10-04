import { useEffect } from 'react'
import type { A2UIDocument } from '../../a2ui/types'
import { useStudioStore, type StudioEditor } from './studioStore'

/** Long enough that a paste does not fire a request per keystroke. */
const VALIDATE_DEBOUNCE_MS = 450

/**
 * The document the preview shows: what the current text parses to, falling back
 * to the last document that parsed so a half-typed edit does not blank the
 * preview. Everything else in the Studio reads `editor.parsed`, which is the
 * text on screen — see the editor rules in CLAUDE.md.
 */
export function previewDocument(editor: StudioEditor): A2UIDocument | null {
  return editor.parsed ?? editor.lastGood
}

/** Runs the same validator the agent is held to, as you type. */
export function useLiveValidation(editor: StudioEditor): void {
  const validateNow = useStudioStore((s) => s.validateNow)
  useEffect(() => {
    if (!editor.parsed) return
    const timer = setTimeout(() => void validateNow(), VALIDATE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [editor.json, editor.parsed, validateNow])
}
