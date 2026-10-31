import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import { finishCharacterSetup } from './setup'

// Story-mode loot with the demo GM (DND_DEMO_GM=1, no key): the chest reveal plays for each item,
// the items land in the Inventory, and the sword can be equipped.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const shot = (name: string) => join(HERE, 'results', name)

test('declared loot plays the reveal and lands in the inventory', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))

    await expect(page.getByText('Your Game Master is still asleep')).toHaveCount(0) // demo mode hides the banner
    await page.getByPlaceholder('Campaign name').fill('The Old Chest')
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    await finishCharacterSetup(page, 'Ilse')

    const composer = page.getByLabel('What do you do?')
    await composer.fill('I open the old chest and find a glowing sword.')
    await composer.press('Enter')

    // One reveal per item, in order.
    const reveal = page.getByTestId('loot-reveal')
    await expect(reveal.getByRole('heading', { name: 'Sunforged Blade' })).toBeVisible({ timeout: 30_000 })
    await expect(reveal).toContainText('Rare weapon')
    await page.waitForTimeout(700) // let the beams spin up for the screenshot
    await page.screenshot({ path: shot('loot.png') })
    await reveal.getByRole('button', { name: 'Take it · next' }).click()

    await expect(reveal.getByRole('heading', { name: 'Healing Draught' })).toBeVisible()
    await expect(reveal).toContainText('+3')
    await reveal.getByRole('button', { name: 'Take it · next' }).click()

    await expect(reveal.getByRole('heading', { name: 'Amulet of the Tides' })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('loot-legendary.png') })
    await reveal.getByRole('button', { name: 'Take it', exact: true }).click()
    await expect(reveal).toHaveCount(0)

    // The items are in the pack, and the sword goes to the main hand.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Inventory' }).click()
    const grid = page.getByTestId('item-grid')
    await expect(grid.getByRole('button')).toHaveCount(3)
    await grid.getByRole('button', { name: 'Sunforged Blade' }).click()
    await page.getByTestId('item-card').getByRole('button', { name: 'Equip' }).click()
    await expect(page.locator('[data-slot="mainHand"]').getByRole('button', { name: 'Sunforged Blade' })).toBeVisible()
    await expect(page.getByTestId('equipment')).toContainText('attack +5')
    await expect(page.getByTestId('purse')).toContainText('Worth about 3 Gold 9 Silver')

    await page.mouse.move(5, 900)
    await page.waitForTimeout(600)
    await page.screenshot({ path: shot('inventory.png') })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
