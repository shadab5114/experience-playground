import { useEffect } from 'react'
import { navigate, STUDIO_SECTIONS, type StudioSection } from '../../app/useHashRoute'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CompositionEditor } from './CompositionEditor'
import { CompositionList } from './CompositionList'
import { MappingsSection } from './MappingsSection'
import { PageEditor } from './PageEditor'
import { PageList } from './PageList'
import { NEW_RECORD, useStudioStore } from './studioStore'
import styles from './StudioView.module.css'

const SECTION_LABELS: Record<StudioSection, string> = {
  compositions: 'Compositions',
  pages: 'Pages',
  mappings: 'Mappings',
}

/** The sections that open a record editor, and what to call a new one. */
const EDITABLE: Partial<Record<StudioSection, { newLabel: string }>> = {
  compositions: { newLabel: 'New composition' },
  pages: { newLabel: 'New page' },
}

export function StudioView({ section, id }: { section: StudioSection; id?: string }) {
  const loading = useStudioStore((s) => s.loading)
  const loaded = useStudioStore((s) => s.loaded)
  const error = useStudioStore((s) => s.error)
  const compositions = useStudioStore((s) => s.compositions)
  const pages = useStudioStore((s) => s.pages)
  const editor = useStudioStore((s) => s.editor)
  const pendingDelete = useStudioStore((s) => s.pendingDelete)
  const notice = useStudioStore((s) => s.notice)

  const load = useStudioStore((s) => s.load)
  const openComposition = useStudioStore((s) => s.openComposition)
  const openPage = useStudioStore((s) => s.openPage)
  const closeEditor = useStudioStore((s) => s.closeEditor)
  const save = useStudioStore((s) => s.save)
  const askDelete = useStudioStore((s) => s.askDelete)
  const cancelDelete = useStudioStore((s) => s.cancelDelete)
  const confirmDelete = useStudioStore((s) => s.confirmDelete)
  const importSamples = useStudioStore((s) => s.importSamples)
  const clearNotice = useStudioStore((s) => s.clearNotice)

  useEffect(() => {
    void load()
  }, [load])

  // The URL is the source of truth for which record is open, so a deep link and
  // a click through the list both land in the same place.
  useEffect(() => {
    if (!id || !EDITABLE[section]) {
      closeEditor()
      return
    }
    void (section === 'compositions' ? openComposition(id) : openPage(id))
  }, [section, id, openComposition, openPage, closeEditor])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(clearNotice, 2600)
    return () => clearTimeout(timer)
  }, [notice, clearNotice])

  // No count for mappings: it is per-page, so a single number next to the nav
  // item would mean "placements on whichever page happens to be selected".
  const counts: Record<StudioSection, number | undefined> = {
    compositions: compositions.length,
    pages: pages.length,
    mappings: undefined,
  }

  const handleSave = async () => {
    const savedId = await save()
    // A new record's id is only known after it saves; move the URL onto it so a
    // reload reopens the saved record rather than a blank "new" form.
    if (savedId && savedId !== id) navigate({ mode: 'studio', section, id: savedId })
  }

  return (
    <div className={styles.studio}>
      <nav className={styles.sidebar} aria-label="Studio sections">
        {STUDIO_SECTIONS.map((item) => (
          <button
            key={item}
            type="button"
            className={`${styles.navItem} ${item === section ? styles.navItemActive : ''}`}
            aria-current={item === section ? 'page' : undefined}
            onClick={() => navigate({ mode: 'studio', section: item })}
          >
            {SECTION_LABELS[item]}
            {counts[item] !== undefined && <span className={styles.navCount}>{counts[item]}</span>}
          </button>
        ))}

        <div className={styles.sidebarFooter}>
          <Button small onClick={() => void importSamples()}>
            Re-import samples
          </Button>
          <span className={styles.sidebarNote}>
            Insert-only: it adds what is missing and never overwrites what you authored.
          </span>
        </div>
      </nav>

      <section className={styles.main}>
        <div className={styles.crumbBar}>
          {editor ? (
            <>
              <button type="button" className={styles.crumbLink} onClick={() => navigate({ mode: 'studio', section })}>
                {SECTION_LABELS[section]}
              </button>
              <span className={styles.crumbMuted}>›</span>
              <span className={styles.crumb}>{editor.isNew ? `New ${editor.kind}` : (editor.savedId ?? '')}</span>
              {editor.origin === 'sample' && <span className={`${styles.chip} ${styles.chipSample}`}>Sample</span>}
              {editor.dirty && <span className={styles.chip}>Unsaved</span>}
              <div className={styles.crumbActions}>
                <Button
                  variant="primary"
                  disabled={editor.saving || !editor.parsed || !editor.dirty}
                  onClick={() => void handleSave()}
                >
                  {editor.saving ? 'Saving…' : 'Save'}
                </Button>
                {editor.savedId !== null && (
                  <Button variant="danger" onClick={() => void askDelete(editor.kind, editor.savedId ?? '')}>
                    Delete
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <span className={styles.crumb}>{SECTION_LABELS[section]}</span>
              {EDITABLE[section] && (
                <div className={styles.crumbActions}>
                  <Button variant="primary" onClick={() => navigate({ mode: 'studio', section, id: NEW_RECORD })}>
                    {EDITABLE[section]?.newLabel}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.content}>
          {error && (
            <div className={`${styles.message} ${styles.messageError}`} role="alert">
              {error}
            </div>
          )}
          {loading && !loaded && <div className={`${styles.message} ${styles.messageInfo}`}>Loading…</div>}

          {editor?.kind === 'composition' && <CompositionEditor editor={editor} />}
          {editor?.kind === 'page' && <PageEditor editor={editor} />}

          {!editor && loaded && section === 'compositions' && (
            <CompositionList
              compositions={compositions}
              onOpen={(openId) => navigate({ mode: 'studio', section: 'compositions', id: openId })}
            />
          )}
          {!editor && loaded && section === 'pages' && (
            <PageList pages={pages} onOpen={(openId) => navigate({ mode: 'studio', section: 'pages', id: openId })} />
          )}
          {!editor && loaded && section === 'mappings' && (
            <MappingsSection {...(id ? { pageTemplateId: id } : {})} />
          )}
        </div>
      </section>

      {notice && <div className={styles.notice}>{notice}</div>}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.id}?`}
          confirmLabel="Delete"
          destructive
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
        >
          <CascadeWarning
            placements={pendingDelete.impact.placements}
            savedVersions={pendingDelete.impact.savedVersions}
            origin={pendingDelete.impact.origin}
          />
        </ConfirmDialog>
      )}
    </div>
  )
}

/**
 * Q2 in docs/AUTHORING_UI_PLAN.md: a hard delete cascades, so the dialog names
 * the counts before the click, and says whether a re-import can bring the
 * record back.
 */
function CascadeWarning({
  placements,
  savedVersions,
  origin,
}: {
  placements: number
  savedVersions: number
  origin: 'sample' | 'authored'
}) {
  const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
  const cascades = [
    placements > 0 ? plural(placements, 'placement') : null,
    savedVersions > 0 ? plural(savedVersions, 'saved version') : null,
  ].filter((x): x is string => x !== null)

  return (
    <>
      {cascades.length > 0 ? (
        <>
          <p className={styles.dialogBody}>This also deletes:</p>
          <ul className={styles.dialogCascades}>
            {cascades.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.dialogBody}>Nothing else points at this record.</p>
      )}

      {savedVersions > 0 && (
        <p className={`${styles.dialogBody} ${styles.dialogIrreversible}`}>
          Deleting version history cannot be undone.
        </p>
      )}

      <p className={styles.dialogBody}>
        {origin === 'sample'
          ? 'This came from the pack’s samples, so “Re-import samples” can bring the record back — but not any edits you made to it.'
          : 'This was authored here, so re-importing samples will not bring it back.'}
      </p>
    </>
  )
}
