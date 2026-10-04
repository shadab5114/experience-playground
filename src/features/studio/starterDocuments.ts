import type { A2UIDocument } from '../../a2ui/types'
import { catalogId } from '../../a2ui/schema'

/**
 * The document a brand-new composition starts from: the smallest thing that
 * renders and passes validation, so the preview and the validation panel are
 * both meaningful from the first keystroke rather than showing errors until
 * someone pastes a real document.
 *
 * TileContainer is the card chrome (background/padding/radius/shadow); Stack is
 * the flexbox layout inside it. Same shape as the sample tiles.
 */
export function newCompositionDocument(): A2UIDocument {
  return {
    meta: {
      provider: 'studio',
      model: 'experience-playground-studio',
      catalogId,
      components: ['TileContainer', 'Stack', 'Text'],
      generatedAt: new Date().toISOString(),
    },
    a2ui: [
      { version: 'v0.9', createSurface: { surfaceId: 'main', catalogId } },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'main',
          path: '/',
          value: { plan: { eyebrow: 'NEW TILE', name: 'Untitled plan' } },
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'main',
          components: [
            {
              id: 'root',
              component: 'TileContainer',
              surface: 'lightPrimary',
              background: 'lightSecondary',
              padding: '6X',
              borderRadius: 'standard',
              dropShadow: 'subtle',
              aspectRatio: 'none',
              width: '100%',
              children: ['content'],
            },
            {
              id: 'content',
              component: 'Stack',
              direction: 'column',
              gap: '8px',
              align: 'start',
              children: ['eyebrow', 'title'],
            },
            {
              id: 'eyebrow',
              component: 'Text',
              kind: 'body',
              size: 'small',
              bold: true,
              children: { path: '/plan/eyebrow' },
            },
            {
              id: 'title',
              component: 'Text',
              kind: 'title',
              size: 'large',
              bold: true,
              children: { path: '/plan/name' },
            },
          ],
        },
      },
    ],
  }
}

/**
 * The document a brand-new page template starts from. A page is a page because
 * it declares `Slot` nodes — `Slot` is playground-native, allowed only in pages
 * — so the starter carries one. Its slots are derived from these nodes, never
 * typed in, which is why there is no slots field in the page form.
 */
export function newPageDocument(): A2UIDocument {
  return {
    meta: {
      provider: 'studio',
      model: 'experience-playground-studio',
      catalogId,
      components: ['Stack', 'Text', 'Slot'],
      generatedAt: new Date().toISOString(),
    },
    a2ui: [
      { version: 'v0.9', createSurface: { surfaceId: 'main', catalogId } },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'main',
          path: '/',
          value: { page: { heading: 'Untitled page' } },
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'main',
          components: [
            {
              id: 'root',
              component: 'Stack',
              direction: 'column',
              gap: '20px',
              padding: '24px',
              width: '100%',
              children: ['heading', 'plan-slot'],
            },
            {
              id: 'heading',
              component: 'Text',
              kind: 'title',
              size: 'xlarge',
              bold: true,
              children: { path: '/page/heading' },
            },
            { id: 'plan-slot', component: 'Slot', slotId: 'plan-summary' },
          ],
        },
      },
    ],
  }
}
