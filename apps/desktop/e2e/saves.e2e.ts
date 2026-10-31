import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import { finishCharacterSetup } from './setup'

// Save points and sound with the demo GM: the scene has an ambience, loot plays its effect, a save point
// rewinds the loot away, and a branch becomes its own campaign on Home.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const shot = (name: string) => join(HERE, 'results', name)

test('a save point rewinds the story, and a branch starts a new campaign', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))
    const html = page.locator('html')
    const nav = page.getByRole('navigation', { name: 'Main' })

    await expect(html).toHaveAttribute('data-ambience', '')
    await page.getByPlaceholder('Campaign name').fill('Fork Road')
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    await finishCharacterSetup(page, 'Ilse')
    await expect(html).toHaveAttribute('data-ambience', /^(tavern|town|wilds|dungeon|sea|night)$/)

    const composer = page.getByLabel('What do you do?')
    await composer.fill('I push open the tavern door and step out of the rain.')
    await composer.press('Enter')
    await expect(page.getByTestId('speech').first()).toBeVisible({ timeout: 30_000 })
    await expect(html).toHaveAttribute('data-last-sfx', 'send')

    // A named save point before the chest.
    await page.getByRole('button', { name: 'Save points' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save points' })
    await dialog.getByLabel('Save point name').fill('Before the chest')
    await dialog.getByRole('button', { name: 'Save point now' }).click()
    await expect(dialog.getByTestId('save-point')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // Loot, with its sound.
    await composer.fill('I open the old chest and look inside.')
    await composer.press('Enter')
    const reveal = page.getByTestId('loot-reveal')
    await expect(reveal.getByRole('heading', { name: 'Sunforged Blade' })).toBeVisible({ timeout: 30_000 })
    await expect(html).toHaveAttribute('data-last-sfx', 'legendary')
    await reveal.getByRole('button', { name: 'Take it · next' }).click()
    await reveal.getByRole('button', { name: 'Take it · next' }).click()
    await reveal.getByRole('button', { name: 'Take it', exact: true }).click()

    // Rewind: the loot is gone, and where we were is kept as a save point.
    await page.getByRole('button', { name: 'Save points' }).click()
    const point = dialog.getByTestId('save-point').filter({ hasText: 'Before the chest' })
    await point.getByRole('button', { name: 'Rewind' }).click()
    await point.getByRole('button', { name: 'Yes' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('I open the old chest and look inside.')).toHaveCount(0)
    await nav.getByRole('button', { name: 'Inventory' }).click()
    await expect(page.getByTestId('item-grid').getByRole('button')).toHaveCount(0)

    // Branch from the save point: a second campaign on Home.
    await nav.getByRole('button', { name: 'Adventure' }).click()
    await page.getByRole('button', { name: 'Save points' }).click()
    await expect(dialog.getByTestId('save-point').filter({ hasText: 'Before a rewind' })).toHaveCount(1)
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('save-points.png') })
    await dialog.getByTestId('save-point').filter({ hasText: 'Before the chest' }).getByRole('button', { name: 'Branch' }).click()
    await expect(page.getByText(/New campaign “Fork Road \(branch, day 1\)”/)).toBeVisible()
    await page.keyboard.press('Escape')
    await nav.getByRole('button', { name: 'Home' }).click()
    await expect(page.getByText('Fork Road (branch, day 1)')).toBeVisible()
    await expect(page.getByText(/saved “/).first()).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
