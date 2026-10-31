import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import { finishCharacterSetup } from './setup'

// DnD mode with the demo GM (DND_DEMO_GM=1, no key): hero setup, a check rolled on the 3D die,
// a short goblin fight run by the engine, the Hero screen, and switching back to Story mode.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const shot = (name: string) => join(HERE, 'results', name)

test('a DnD scene: hero setup, a check, and a short fight, all on engine dice', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))

    await page.getByPlaceholder('Campaign name').fill('Goblin Pass')
    await page.getByRole('button', { name: /Dice decide your fate/ }).click()
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    await finishCharacterSetup(page, 'Rook')

    // Hero setup: pick the Rogue, move a point from Charisma to Wisdom, name them.
    const setup = page.getByTestId('hero-setup')
    await expect(setup.getByTestId('hero-option')).toHaveCount(5)
    await page.mouse.move(5, 900)
    await page.waitForTimeout(600)
    await page.screenshot({ path: shot('hero-setup.png') })
    await setup.getByTestId('hero-option').filter({ hasText: 'Rogue' }).click()
    await expect(setup.getByTestId('points-left')).toContainText('0 of 27')
    await setup.getByRole('button', { name: 'Lower Charisma' }).click()
    await setup.getByRole('button', { name: 'Raise Wisdom' }).click()
    await expect(setup.getByTestId('points-left')).toContainText('1 of 27')
    await setup.getByLabel('Hero name').fill('Rook')
    await setup.getByRole('button', { name: 'Begin as Rook' }).click()
    await expect(setup).toHaveCount(0)
    await expect(page.getByTestId('hud-hp')).toHaveText('9/9')

    // A Perception check: Roll, the die lands, the total is shown.
    const composer = page.getByLabel('What do you do?')
    // The textbox stays editable during a turn; the Stop button is what marks it busy.
    const idle = () => expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 })
    await composer.fill('I listen at the door.')
    await composer.press('Enter')
    const check = page.getByTestId('check-card')
    await expect(check.getByRole('button', { name: 'Roll the d20' })).toBeVisible({ timeout: 30_000 })
    await expect(check.getByTestId('die-3d')).toBeVisible()
    await check.getByRole('button', { name: 'Roll the d20' }).click()
    await expect(check.getByTestId('roll-total')).toContainText('=', { timeout: 10_000 })
    const kept = Number((await check.getByTestId('roll-total').innerText()).trim().split(' ')[0])
    expect(kept).toBeGreaterThanOrEqual(1)
    expect(kept).toBeLessThanOrEqual(20)
    await expect(check.locator('[data-value]')).toHaveAttribute('data-value', String(kept))
    await page.waitForTimeout(800) // the 3D die settles; the live card stays up ~2.6 s after the roll
    await page.screenshot({ path: shot('check-3d.png') })
    await idle()

    // The fight: initiative, the goblins act, the player rolls to hit, and the fight ends with XP.
    await composer.fill('I attack the goblins!')
    await composer.press('Enter')
    const tracker = page.getByTestId('combat-tracker')
    await expect(tracker.locator('[data-fighter]')).toHaveCount(3, { timeout: 30_000 })
    await expect(tracker.getByTestId('combat-round')).toHaveText('Round 1')
    await idle()

    await composer.fill('I stab the nearest goblin.')
    await composer.press('Enter')
    const attack = page.getByTestId('attack-card')
    await expect(attack.getByRole('button', { name: 'Roll to hit' })).toBeVisible({ timeout: 30_000 })
    await attack.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('combat.png') })
    await attack.getByRole('button', { name: 'Roll to hit' }).click()
    await expect(attack.getByTestId('roll-total')).toContainText('vs AC', { timeout: 10_000 })
    await idle()
    await expect(tracker).toHaveCount(0)
    await expect(page.getByText('+100 XP').first()).toBeVisible()

    // The Hero screen shows the XP; switching to Story hides the hero panel.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Hero' }).click()
    await expect(page.getByTestId('hero-xp')).toContainText('100')
    await page.mouse.move(5, 900)
    await page.waitForTimeout(600)
    await page.screenshot({ path: shot('hero.png') })
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Adventure' }).click()
    await page.getByRole('tab', { name: 'Story' }).click()
    await expect(page.getByTestId('hero-panel')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
