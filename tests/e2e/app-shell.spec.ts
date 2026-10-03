import { expect, test } from '@playwright/test'

test('the app shell loads and shows the header bar', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('Experience Playground')).toBeVisible()
  await expect(page.getByText('VDS', { exact: true })).toBeVisible()
})
