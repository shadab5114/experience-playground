import { expect, test } from '@playwright/test'

// The Studio is remote-only, so this spec needs the backend (npm run server:start)
// and VITE_DATA_SOURCE=remote. It skips itself rather than failing when the
// backend is not up, so the suite still runs against the mock playground alone.
const ID = 'walkthrough-tile'
const API = 'http://localhost:8787'

test.beforeAll(async ({ request }) => {
  const reachable = await request
    .get(`${API}/health`)
    .then((r) => r.ok())
    .catch(() => false)
  test.skip(!reachable, `No Experience Agent backend at ${API}; start it with npm run server:start`)
})

// The walkthrough creates a record, so it has to start from a clean slate to be
// repeatable: a leftover tile would make the first save version 2.
test.beforeEach(async ({ request }) => {
  await request.delete(`${API}/v1/authoring/compositions/${ID}`)
})

// Plain fetch, not the `request` fixture: that fixture is test-scoped and is
// not available in afterAll, so the cleanup would quietly never run.
test.afterAll(async () => {
  await fetch(`${API}/v1/authoring/compositions/${ID}`, { method: 'DELETE' }).catch(() => undefined)
})

test('studio round trip: create, validate, reject, save, see in picker, delete', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  // 1. The Studio toggle exists in remote mode.
  await page.goto('/')
  // Hidden in mock mode, so its absence means the app is not pointed at the backend.
  await expect(page.getByRole('button', { name: 'Studio' })).toBeVisible()
  await page.getByRole('button', { name: 'Studio' }).click()
  await expect(page).toHaveURL(/#\/studio\/compositions$/)

  // 2. The list shows the seeded samples with their Sample chips.
  await expect(page.getByRole('button', { name: /Basic Plan/ })).toBeVisible()
  await expect(page.getByText('Sample').first()).toBeVisible()

  // 3. New composition: the starter document must already render and validate.
  await page.getByRole('button', { name: 'New composition' }).click()
  await expect(page).toHaveURL(/#\/studio\/compositions\/new$/)
  const preview = page.getByTestId('tile-inner-container-tile-container')
  await expect(preview.getByText('Untitled plan')).toBeVisible()
  await expect(page.getByText(/0 errors/)).toBeVisible()
  await expect(page.getByText('TileContainer, Stack, Text')).toBeVisible()

  // 4. Fill the metadata.
  await page.getByLabel('id').fill(ID)
  await page.getByLabel('name').fill('Walkthrough Tile')
  await page.getByLabel('family').fill('Walkthrough Tile')
  await page.getByLabel('description').fill('Created by the studio walkthrough.')
  await page.getByLabel('agent rules').fill('Never change the price text.')
  await page.getByRole('textbox', { name: 'A2UI document' }).click()

  // 5. Broken JSON: the parse error shows and the preview survives.
  const json = page.getByRole('textbox', { name: 'A2UI document' })
  const good = await json.inputValue()
  await json.fill(good.slice(0, 40))
  await expect(page.getByText('Showing the last document that parsed.')).toBeVisible()

  // 6. A document that breaks DS-103 must be rejected with that code.
  const doc = JSON.parse(good) as {
    a2ui: { updateComponents?: { components: Record<string, unknown>[] } }[]
  }
  const components = doc.a2ui.find((m) => m.updateComponents)!.updateComponents!.components
  const content = components.find((c) => c.id === 'content')!
  content.children = [...(content.children as string[]), 'badge']
  components.push({ id: 'badge', component: 'Badge', children: 'This badge text is far too long' })
  await json.fill(JSON.stringify(doc, null, 2))
  await expect(page.getByText('rules/DS-103')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/1 error/)).toBeVisible()

  // 7. Back to a good document, then save.
  await json.fill(good)
  await expect(page.getByText(/0 errors/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved as version 1')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#/studio/compositions/${ID}$`))
  const history = page.locator('section').filter({ hasText: 'HISTORY' })
  await expect(history.getByText('v1', { exact: true })).toBeVisible()
  await expect(history.getByText('studio', { exact: true })).toBeVisible()

  // 8. A second save bumps the version.
  await page.getByLabel('name').fill('Walkthrough Tile v2')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved as version 2')).toBeVisible()

  // 9. The new tile shows up in the Playground picker (cache invalidation).
  await page.getByRole('button', { name: 'Playground' }).click()
  await expect(page.getByText('Walkthrough Tile v2')).toBeVisible({ timeout: 10_000 })

  // 10. A deep link reopens the record directly.
  await page.goto(`/#/studio/compositions/${ID}`)
  await expect(page.getByLabel('name')).toHaveValue('Walkthrough Tile v2')
  await expect(
    page.locator('section').filter({ hasText: 'HISTORY' }).getByText('v2', { exact: true }),
  ).toBeVisible()

  // 11. Delete names the cascade and says it is gone for good.
  await page.getByRole('button', { name: 'Delete' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('2 saved versions')).toBeVisible()
  await expect(dialog.getByText(/cannot be undone/)).toBeVisible()
  await expect(dialog.getByText(/will not bring it back/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText(`Deleted ${ID}`)).toBeVisible()
  await expect(page).toHaveURL(/#\/studio\/compositions\/walkthrough-tile$/)

  expect(errors.filter((e) => !e.includes('favicon'))).toEqual([])
})
