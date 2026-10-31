import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { finishCharacterSetup } from './setup'

// Quests and the world map with the demo GM (DND_DEMO_GM=1, no key): taking a job marks the Old Mill under fog
// with a quest marker; Travel here on the map sends the journey as a turn, which moves the clock and the scene.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const shot = (name: string) => join(HERE, 'results', name)

const idle = (page: Page) => expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 })
const settle = async (page: Page) => {
  await page.mouse.move(5, 900)
  await page.waitForTimeout(600)
}

test('taking a quest marks the map, and travelling there moves the clock and the scene', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))

    await page.getByPlaceholder('Campaign name').fill('Mill Road')
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    await finishCharacterSetup(page, 'Ilse')

    // The elder's job: a quest, and the Old Mill on the map.
    const composer = page.getByLabel('What do you do?')
    await composer.fill('I take the job.')
    await composer.press('Enter')
    await expect(page.getByTestId('place-chip')).toContainText('The Old Mill', { timeout: 30_000 })
    await idle(page)
    await expect(page.getByTestId('hud-clock')).toHaveText('08:00')

    // The map: here, plus the rumoured mill with a quest marker.
    const nav = page.getByRole('navigation', { name: 'Main' })
    await nav.getByRole('button', { name: 'Map' }).click()
    const mill = page.locator('[data-testid="map-pin"][data-place="The Old Mill"]')
    await expect(page.locator('[data-testid="map-pin"][data-state="current"]')).toHaveAttribute('data-place', 'Millbrook Square')
    await expect(mill).toHaveAttribute('data-state', 'rumoured')
    await expect(mill.getByTestId('quest-marker')).toHaveCount(1)
    // The quest marker pulses forever, so the pin never counts as "stable" for Playwright.
    await mill.click({ force: true })
    await expect(page.getByTestId('place-card')).toContainText('The Missing Miller')
    await expect(page.getByTestId('trip')).toContainText('~6 h north')
    await settle(page)
    await page.screenshot({ path: shot('map.png') })

    // Travel there: a turn the GM narrates, and the clock moves about six hours.
    await page.getByRole('button', { name: 'Travel here' }).click()
    await expect(page.getByRole('log', { name: 'Story so far' }).getByText(/The Old Mill rises out of the mist/)).toBeVisible({ timeout: 30_000 })
    await idle(page)
    // The old time pops out while the new one pops in; wait for the exit to finish.
    await expect(page.getByTestId('hud-clock')).toHaveCount(1)
    await expect(page.getByTestId('hud-clock')).toHaveText(/^1[3-5]:\d\d$/)

    // Back on the map the mill is visited and current; the quest book points to it too.
    await nav.getByRole('button', { name: 'Map' }).click()
    await expect(mill).toHaveAttribute('data-state', 'current')
    await settle(page)
    await page.screenshot({ path: shot('map-travelled.png') })
    await nav.getByRole('button', { name: 'Journal' }).click()
    await page.getByRole('tab', { name: 'Quests' }).click()
    await expect(page.getByTestId('quest-place')).toContainText('The Old Mill')
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
