import { expect, test } from '@playwright/test'

// Runs against the real backend. Start it first (npm run server:start), then:
//   VITE_DATA_SOURCE=remote npx playwright test tests/e2e/remote-mode.spec.ts
test.skip(process.env.VITE_DATA_SOURCE !== 'remote', 'remote mode only')

test('remote mode: picker, impacts and a prompt all run against the backend', async ({ page }) => {
  await page.goto('/')

  // The picker is open on load; it lists the three seeded compositions.
  await expect(page.getByRole('button', { name: /Basic Plan – Mobile/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Home Plan/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Order Summary/ })).toBeVisible()

  // Picking one renders it.
  await page.getByRole('button', { name: /Basic Plan – Mobile/ }).click()
  await expect(page.getByText('You selected Basic Plan – Mobile')).toBeVisible()

  // View Impacts renders the three seeded pages, each with its slot hosted.
  await page.getByRole('button', { name: 'View impacts' }).click()
  for (const tab of ['PDP', 'AAL', 'Order Summary']) {
    await expect(page.getByRole('tab', { name: tab })).toBeVisible()
  }
  await expect(page.locator('.a2ui-slot-host').first()).toBeVisible()

  // A prompt shows the scripted status steps from the backend's stream.
  await page.getByRole('tab', { name: 'PDP' }).click()
  await page.getByLabel('Chat input').fill('make the badge smaller')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('Understanding your request').first()).toBeVisible()
  await expect(page.getByText('Applying the change').first()).toBeVisible()
  await expect(page.getByText('Scripted run: no change applied.')).toBeVisible()
})
