import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import { finishCharacterSetup } from './setup'

// Generated art with the demo GM (DND_DEMO_GM=1, demo image and 3D generators, no key): the hero and the
// tavern people get portraits on their own, rare loot gets an icon, the legendary amulet becomes a 3D model,
// and the campaign's style lock changes in Settings → Art.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const shot = (name: string) => join(HERE, 'results', name)

test('portraits, item icons and a 3D model appear without blocking play', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))

    await page.getByPlaceholder('Campaign name').fill('The Painted Road')
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    await finishCharacterSetup(page, 'Ilse')

    // The hero is drawn once setup is done.
    await expect(page.getByTestId('hero-portrait').getByTestId('portrait-art')).toBeVisible({ timeout: 20_000 })

    // New people in the tavern get portraits in their speech bubbles.
    const composer = page.getByLabel('What do you do?')
    await composer.fill('I push open the tavern door and step out of the rain.')
    await composer.press('Enter')
    await expect(page.getByTestId('speech').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('speech').first().getByTestId('portrait-art')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('scene-strip').getByTestId('portrait-art').first()).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('art-portraits.png') })

    // Rare and legendary loot get icons; the common potion keeps its glyph.
    await composer.fill('I open the old chest and look inside.')
    await composer.press('Enter')
    const reveal = page.getByTestId('loot-reveal')
    await expect(reveal.getByRole('heading', { name: 'Sunforged Blade' })).toBeVisible({ timeout: 30_000 })
    await reveal.getByRole('button', { name: 'Take it · next' }).click()
    await reveal.getByRole('button', { name: 'Take it · next' }).click()
    await reveal.getByRole('button', { name: 'Take it', exact: true }).click()
    await expect(reveal).toHaveCount(0)

    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Inventory' }).click()
    const grid = page.getByTestId('item-grid')
    await expect(grid.getByRole('button', { name: 'Sunforged Blade' }).getByTestId('item-art')).toBeVisible({ timeout: 20_000 })
    await expect(grid.getByRole('button', { name: 'Amulet of the Tides' }).getByTestId('item-art')).toBeVisible({ timeout: 20_000 })
    await expect(grid.getByRole('button', { name: 'Healing Draught' }).getByTestId('item-art')).toHaveCount(0)

    // The legendary amulet becomes a 3D model, built from its icon.
    await grid.getByRole('button', { name: 'Amulet of the Tides' }).click()
    const card = page.getByTestId('item-card')
    await card.getByRole('button', { name: '3D preview' }).click()
    await card.getByRole('button', { name: 'View in 3D' }).click({ timeout: 20_000 })
    await expect(page.getByTestId('model3d-canvas')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: shot('art-3d.png') })
    await page.keyboard.press('Escape')

    // The style lock: a new preset and a new seed for this campaign.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: 'Art' }).click()
    await page.getByRole('radio', { name: 'Painterly' }).click()
    await expect(page.getByRole('radio', { name: 'Painterly' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Re-roll seed' }).click()
    await expect(page.getByTestId('art-seed')).not.toContainText('from the campaign')
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('art-settings.png') })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
