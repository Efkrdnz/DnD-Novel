import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { finishCharacterSetup } from './setup'

// Long-campaign memory with the demo GM (DND_DEMO_GM=1, no key): on the Thrifty preset, a few turns are enough
// for the Scribe to compact the oldest into a digest. Every turn shows what it cost, and the Game Master
// settings show how much of the campaign is compacted.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const shot = (name: string) => join(HERE, 'results', name)

const idle = (page: Page) => expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 })
const settle = async (page: Page) => {
  await page.mouse.move(5, 900)
  await page.waitForTimeout(600)
}

const MOVES = [
  'I shake the rain off my cloak.',
  'I order a mug of cider.',
  'I listen to the fiddle for a while.',
  'I ask Mira about the storm.',
  'I watch the captain at the back.',
  'I warm my hands by the hearth.',
  'I ask Old Tom about the road north.',
  'I tip my hat to the captain.',
]

test('compacts old turns on the Thrifty preset, with a token meter on every turn', async () => {
  test.setTimeout(240_000)
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))
    const nav = page.getByRole('navigation', { name: 'Main' })

    // The Thrifty preset: 3 turns word for word, a digest every 4.
    await nav.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: 'Game Master' }).click()
    await page.getByRole('tab', { name: 'Thrifty' }).click()
    await expect(page.getByRole('tab', { name: 'Thrifty' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Fewest tokens: 3 turns word for word')).toBeVisible()
    await page.waitForTimeout(1200)

    await nav.getByRole('button', { name: 'Home' }).click()
    await page.getByPlaceholder('Campaign name').fill('Long Night')
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    await finishCharacterSetup(page, 'Ilse')

    const composer = page.getByLabel('What do you do?')
    for (const move of MOVES) {
      await composer.fill(move)
      await composer.press('Enter')
      await expect(page.getByText(move)).toBeVisible()
      await idle(page)
    }
    const meters = page.getByTestId('token-meter')
    expect(await meters.count()).toBeGreaterThanOrEqual(MOVES.length)
    await expect(meters.last()).toHaveText(/^≈[\d.]+k? in · ≈[\d.]+k? out$/)
    await settle(page)
    await page.screenshot({ path: shot('memory-meter.png') })

    // The Scribe compacts in the background; the Game Master tab reads the campaign's memory when it opens.
    await expect(async () => {
      await nav.getByRole('button', { name: 'Adventure' }).click()
      await nav.getByRole('button', { name: 'Settings' }).click()
      await page.getByRole('tab', { name: 'Game Master' }).click()
      await expect(page.getByTestId('memory-stats')).toContainText(/\d+ digests? \(turns 1–\d+ compacted\)/, { timeout: 1500 })
    }).toPass({ timeout: 30_000 })
    await expect(page.getByTestId('memory-stats')).toContainText(/≈[\d.]+k tokens sent/)
    await page.getByTestId('memory-stats').scrollIntoViewIfNeeded()
    await settle(page)
    await page.screenshot({ path: shot('memory-settings.png') })

    // Play goes on after compaction.
    await nav.getByRole('button', { name: 'Adventure' }).click()
    await composer.fill('I raise my mug to the room.')
    await composer.press('Enter')
    await idle(page)
    expect(await meters.count()).toBeGreaterThan(MOVES.length)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
