import { expect, test } from '@playwright/test'

// Remote-only, like the other Studio specs: skips itself when no backend answers.
const API = 'http://localhost:8787'
const PAGE_ID = 'mappings-page'
const FLOW_ID = 'mappings-flow'

test.beforeAll(async ({ request }) => {
  const reachable = await request
    .get(`${API}/health`)
    .then((r) => r.ok())
    .catch(() => false)
  test.skip(!reachable, `No Experience Agent backend at ${API}; start it with npm run server:start`)
})

const reset = async () => {
  await fetch(`${API}/v1/authoring/page-templates/${PAGE_ID}`, { method: 'DELETE' }).catch(() => undefined)
  await fetch(`${API}/v1/authoring/flows/${FLOW_ID}`, { method: 'DELETE' }).catch(() => undefined)
}

test.beforeEach(reset)
test.afterAll(reset)

test('mappings: assign a composition to a slot and see it in the Playground impacts', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // A page with two slots to map into, created over the API so the test is
  // about mappings rather than about the page editor (that is studio-pages).
  await request.put(`${API}/v1/authoring/flows/${FLOW_ID}`, { data: { flowId: FLOW_ID, name: 'Mappings Flow' } })
  const slot = (id: string, slotId: string) => ({ id, component: 'Slot', slotId })
  await request.put(`${API}/v1/authoring/page-templates/${PAGE_ID}`, {
    data: {
      pageTemplateId: PAGE_ID,
      flowId: FLOW_ID,
      name: 'Mappings Page',
      a2ui: {
        a2ui: [
          {
            version: 'v0.9',
            createSurface: { surfaceId: 'main', catalogId: 'https://pdesign.dev/catalog/v1/catalog.json' },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 'main',
              components: [
                { id: 'root', component: 'Stack', direction: 'column', gap: '20px', children: ['a', 'b'] },
                slot('a', 'plan-summary'),
                slot('b', 'promo-rail'),
              ],
            },
          },
        ],
      },
    },
  })

  // 1. The Mappings section lists the page's slots, both unassigned.
  await page.goto(`/#/studio/mappings/${PAGE_ID}`)
  await expect(page.getByText('Flow: Mappings Flow')).toBeVisible()
  const planSelect = page.getByRole('combobox', { name: 'Composition in plan-summary' })
  await expect(planSelect).toHaveValue('')
  // Nothing placed yet, so the page renders its empty slot placeholders.
  await expect(page.getByText('Empty slot: plan-summary')).toBeVisible()

  // 2. Assign a composition; the preview renders it inside the slot.
  await planSelect.selectOption('basic-plan-tile')
  await expect(page.getByText('Empty slot: plan-summary')).toHaveCount(0)
  // .a2ui-slot-host is the stable hook the renderer always wraps hosted content
  // in (src/index.css), so this asserts the tile is inside the slot, not merely
  // somewhere on the page.
  await expect(page.locator('.a2ui-slot-host').getByText('Basic Plan')).toBeVisible()

  // 3. A variant and a position round-trip through the server.
  const variant = page.getByRole('textbox', { name: /Variant for basic-plan-tile/ })
  await variant.fill('compact')
  await variant.blur()
  await expect(page.getByRole('textbox', { name: /Variant for basic-plan-tile/ })).toHaveValue('compact')
  await page.reload()
  await expect(page.getByRole('textbox', { name: /Variant for basic-plan-tile/ })).toHaveValue('compact')

  // 4. The acceptance criterion: the new mapping shows up in the Playground's
  //    Impacts view, as a tab for the flow, without a restart.
  await page.getByRole('button', { name: 'Playground' }).click()
  await page.getByRole('button', { name: /Basic Plan/ }).first().click()
  await page.getByRole('button', { name: 'View impacts' }).click()
  await expect(page.getByRole('tab', { name: 'Mappings Flow' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('tab', { name: 'Mappings Flow' }).click()
  await expect(page.getByText('Updated tile').first()).toBeVisible()

  // 5. Unassigning removes it again, and the slot goes back to its placeholder.
  await page.goto(`/#/studio/mappings/${PAGE_ID}`)
  await page.getByRole('button', { name: 'Remove' }).first().click()
  await expect(page.getByText('Empty slot: plan-summary')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Composition in plan-summary' })).toHaveValue('')

  expect(errors).toEqual([])
})
