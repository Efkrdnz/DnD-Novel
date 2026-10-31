import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { finishCharacterSetup } from './setup'

// Worlds with the demo GM (DND_DEMO_GM=1, no key): a DnD campaign in the Ashen Reach preset (renamed abilities,
// a codex reveal, Era 0), and a World Wizard world that is edited before it begins.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const shot = (name: string) => join(HERE, 'results', name)

async function launch(): Promise<{ app: ElectronApplication; page: Page; errors: string[]; profile: string }> {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))
  return { app, page, errors, profile }
}

const idle = (page: Page) => expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 })

test('a preset world: its own rules, a codex reveal and Era 0', async () => {
  const { app, page, errors, profile } = await launch()
  try {
    await page.getByPlaceholder('Campaign name').fill('Red Moon')
    await page.getByRole('button', { name: /Dice decide your fate/ }).click()
    await page.locator('[data-world="ashen-reach"]').click()
    await expect(page.locator('[data-world="ashen-reach"]')).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(5, 900)
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('world-pick.png') })
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    await finishCharacterSetup(page, 'Mire')

    // Hero setup offers the world's own heroes, with its ability names and power system.
    const setup = page.getByTestId('hero-setup')
    await expect(setup.getByTestId('hero-option')).toHaveCount(5)
    await expect(setup.getByTestId('hero-option').filter({ hasText: 'Blood Knight' })).toContainText('Blood')
    await setup.getByTestId('hero-option').filter({ hasText: 'Hexbinder' }).click()
    await expect(setup.getByRole('button', { name: 'Raise Dread' })).toBeVisible()
    await page.mouse.move(5, 900)
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('ashen-hero.png') })
    await setup.getByLabel('Hero name').fill('Mire')
    await setup.getByRole('button', { name: 'Begin as Mire' }).click()
    await expect(setup).toHaveCount(0)

    // Asking who rules here makes the demo GM reveal the first hidden faction.
    const composer = page.getByLabel('What do you do?')
    await composer.fill('Who rules here?')
    await composer.press('Enter')
    await expect(page.getByTestId('codex-chip').first()).toContainText('The Red Synod', { timeout: 30_000 })
    await idle(page)

    // The Lore Book opens with Era 0; the Codex shows the faction unlocked and the rest still locked.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Journal' }).click()
    const eraZero = page.getByTestId('era-zero')
    await expect(eraZero).toBeVisible()
    await eraZero.getByRole('button').first().click()
    await expect(eraZero).toContainText('The Fall of the Sun-Throne')
    await page.getByRole('tab', { name: 'Codex' }).click()
    const factions = page.locator('[data-testid="codex-entry"][data-kind="faction"]')
    await expect(factions.filter({ hasText: 'The Red Synod' })).toHaveAttribute('data-revealed', 'true')
    await expect(factions.filter({ hasText: 'The Red Synod' })).toContainText('New')
    await expect(page.locator('[data-kind="power"][data-revealed="true"]')).toContainText('Hemocraft')
    await expect(page.locator('[data-kind="faction"][data-revealed="true"]')).toHaveCount(2)
    await expect(page.locator('[data-kind="faction"][data-revealed="false"]')).toHaveCount(2)
    await page.mouse.move(5, 900)
    await page.waitForTimeout(600)
    await page.screenshot({ path: shot('codex.png') })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})

test('a World Wizard world: answer, review, edit and begin', async () => {
  const { app, page, errors, profile } = await launch()
  try {
    await page.getByPlaceholder('Campaign name').fill('Glass Tale')
    await page.locator('[data-world="wizard"]').click()
    await page.getByRole('button', { name: 'Build my world' }).click()

    const wizard = page.getByTestId('world-wizard')
    await expect(wizard.getByTestId('wizard-question')).toHaveCount(5)
    await wizard.getByRole('button', { name: 'Bright and heroic' }).click()
    await wizard.getByLabel('What threatens it?').fill('Glass storms that erase memories')
    await wizard.getByRole('button', { name: 'Build my world' }).click()

    // The demo GM writes all four sections; then edit the name and drop a region.
    await expect(wizard.getByTestId('wizard-section')).toHaveCount(4, { timeout: 30_000 })
    await wizard.getByLabel('World name').fill('The Glass Shore')
    await wizard.getByRole('button', { name: 'Remove Copper Cliffs' }).click()
    await expect(wizard.locator('[data-entry="Copper Cliffs"]')).toHaveCount(0)
    await page.mouse.move(5, 900)
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('wizard-review.png') })
    await wizard.getByRole('button', { name: 'Begin in The Glass Shore' }).click()

    // The campaign starts in the edited world, and its codex lists the three remaining regions.
    await expect(wizard).toHaveCount(0, { timeout: 15_000 })
    await finishCharacterSetup(page, 'Sana')
    await expect(page.getByText(/The Glass Shore/i).first()).toBeVisible()
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Journal' }).click()
    await page.getByRole('tab', { name: 'Codex' }).click()
    await expect(page.locator('[data-testid="codex-entry"][data-kind="region"]')).toHaveCount(3)
    await expect(page.locator('[data-kind="region"][data-revealed="true"]')).toContainText('Shimmer Dunes')
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
