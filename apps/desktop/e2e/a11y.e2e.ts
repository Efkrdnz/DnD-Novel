import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { finishCharacterSetup } from './setup'

// Accessibility: axe finds no serious or critical WCAG 2 A/AA problems on the main screens, and dialogs keep
// keyboard focus inside them.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')

async function problems(page: Page, screen: string): Promise<string[]> {
  await page.waitForTimeout(600) // let entrance animations settle
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa']).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${screen}: ${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

test('the main screens pass an accessibility check', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))
    const nav = page.getByRole('navigation', { name: 'Main' })
    const found: string[] = []

    await expect(page.getByPlaceholder('Campaign name')).toBeVisible()
    found.push(...(await problems(page, 'Home')))

    await page.getByPlaceholder('Campaign name').fill('Quiet Road')
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    await finishCharacterSetup(page, 'Ilse')
    const composer = page.getByLabel('What do you do?')
    await composer.fill('I push open the tavern door and step out of the rain.')
    await composer.press('Enter')
    await expect(page.getByTestId('speech').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('announcer')).not.toBeEmpty()
    found.push(...(await problems(page, 'Adventure')))

    // A dialog takes focus, keeps Tab inside, and gives focus back when it closes.
    const opener = page.getByRole('button', { name: 'Save points' })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Save points' })
    await expect(dialog.locator(':focus')).toHaveCount(1)
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
    await expect(dialog.locator(':focus')).toHaveCount(1)
    found.push(...(await problems(page, 'Save points')))
    await page.keyboard.press('Escape')
    await expect(opener).toBeFocused()

    await nav.getByRole('button', { name: 'Inventory' }).click()
    found.push(...(await problems(page, 'Inventory')))

    await nav.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: 'Sound' }).click()
    await expect(page.getByRole('slider', { name: 'Music' })).toBeVisible()
    found.push(...(await problems(page, 'Settings')))

    expect(found).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
