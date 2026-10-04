import { expect, test } from '@playwright/test'

// Remote-only, like studio-walk.spec.ts: skips itself when no backend answers.
const PAGE_ID = 'walkthrough-page'
const API = 'http://localhost:8787'

test.beforeAll(async ({ request }) => {
  const reachable = await request
    .get(`${API}/health`)
    .then((r) => r.ok())
    .catch(() => false)
  test.skip(!reachable, `No Experience Agent backend at ${API}; start it with npm run server:start`)
})

test.beforeEach(async ({ request }) => {
  await request.delete(`${API}/v1/authoring/page-templates/${PAGE_ID}`)
})

// Plain fetch, not the `request` fixture: that fixture is test-scoped and is
// not available in afterAll, so the cleanup would quietly never run.
test.afterAll(async () => {
  await fetch(`${API}/v1/authoring/page-templates/${PAGE_ID}`, { method: 'DELETE' }).catch(() => undefined)
})

test('page editor: create a page, derive its slots, delete it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // 1. The Pages section lists the sample pages with their derived slots.
  await page.goto('/#/studio/pages')
  await expect(page.getByRole('button', { name: /PDP/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /pdp-mock/ }).getByText('plan-summary')).toBeVisible()

  // 2. A new page starts from a document that already declares a slot.
  await page.goto('/#/studio/pages')
  await page.getByRole('button', { name: 'New page' }).click()
  const slotsPanel = page.locator('section').filter({ hasText: 'SLOTS (DERIVED)' })
  await expect(slotsPanel.getByText('plan-summary', { exact: true })).toBeVisible()
  await expect(page.getByText(/0 errors/)).toBeVisible({ timeout: 10_000 })

  // 3. Fill it in.
  await page.getByLabel('id').fill(PAGE_ID)
  await page.getByLabel('name', { exact: true }).fill('Walkthrough Page')
  await page.getByLabel('description').fill('Created by the page walkthrough.')

  // 4. Slots are derived from Slot nodes, not typed: adding one updates the panel.
  const json = page.getByRole('textbox', { name: 'A2UI document' })
  const good = await json.inputValue()
  const doc = JSON.parse(good) as { a2ui: { updateComponents?: { components: Record<string, unknown>[] } }[] }
  const components = doc.a2ui.find((m) => m.updateComponents)!.updateComponents!.components
  const root = components.find((c) => c.id === 'root')!
  root.children = [...(root.children as string[]), 'promo-slot']
  components.push({ id: 'promo-slot', component: 'Slot', slotId: 'promo-rail' })
  await json.fill(JSON.stringify(doc, null, 2))
  await expect(slotsPanel.getByText('promo-rail', { exact: true })).toBeVisible()

  // 5. Save, and the server's derived slots come back.
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(`Saved ${PAGE_ID}`)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#/studio/pages/${PAGE_ID}$`))
  await expect(slotsPanel.getByText('promo-rail', { exact: true })).toBeVisible()

  // 6. The list shows it with both slots, and no Sample chip.
  await page.goto('/#/studio/pages')
  const row = page.getByRole('button', { name: new RegExp(PAGE_ID) })
  await expect(row.getByText('plan-summary')).toBeVisible()
  await expect(row.getByText('promo-rail')).toBeVisible()

  // 7. A composition document is rejected as a page's content would be: a page
  //    without a Slot still validates, but a Slot inside a composition does not.
  await page.goto(`/#/studio/pages/${PAGE_ID}`)
  await expect(page.getByLabel('name', { exact: true })).toHaveValue('Walkthrough Page')

  // 9. Delete names the cascade for a page (no version history to lose).
  await page.goto(`/#/studio/pages/${PAGE_ID}`)
  await page.getByRole('button', { name: 'Delete' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/will not bring it back/)).toBeVisible()
  await expect(dialog.getByText(/cannot be undone/)).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText(`Deleted ${PAGE_ID}`)).toBeVisible()

  expect(errors).toEqual([])
})
