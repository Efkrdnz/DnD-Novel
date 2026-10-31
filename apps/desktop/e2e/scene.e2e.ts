import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import { finishCharacterSetup } from './setup'

// Plays one scripted turn (DND_DEMO_GM=1, no key needed) and checks that a 3-character
// scene renders as speech bubbles with a scene strip, without renderer errors.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const SCREENSHOT = join(HERE, 'results', 'scene.png')

test('a three-character scene reads like a visual novel', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const app = await electron.launch({
    args: [APP_DIR, `--user-data-dir=${profile}`],
    env: { ...process.env, DND_DEMO_GM: '1' },
  })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))

    await page.getByPlaceholder('Campaign name').fill('The Gilded Gull')
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    await finishCharacterSetup(page, 'Ilse')

    const composer = page.getByLabel('What do you do?')
    await composer.fill('I push open the tavern door and step out of the rain.')
    await composer.press('Enter')

    // The turn is done when the three new characters stand in the scene strip.
    const strip = page.getByTestId('scene-strip')
    await expect(strip.getByRole('button')).toHaveCount(3, { timeout: 30_000 })

    const speakers = await page.getByTestId('speech').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-speaker')))
    expect(new Set(speakers)).toEqual(new Set(['Mira', 'Old Tom', 'Captain Vex']))
    await expect(page.getByText('Talking to: everyone')).toBeVisible()

    // Pick someone to talk to from the strip.
    await strip.getByRole('button', { name: 'Talk to Mira' }).click()
    await expect(page.getByText('Talking to: Mira')).toBeVisible()

    // A taller window shows the whole scene; move the mouse off the portraits so no hover card covers it.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1080))
    await page.mouse.move(5, 700)
    await page.waitForTimeout(900) // let the entrance animations settle
    await page.screenshot({ path: SCREENSHOT })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
