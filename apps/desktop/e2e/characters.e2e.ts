import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

// Character setup, bonds and story routes with the demo GM (DND_DEMO_GM=1, no key): a Romance campaign whose
// hero brings a love interest, a companion who answers by bond stage, and a switch to Horror mid-campaign.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const shot = (name: string) => join(HERE, 'results', name)

const idle = (page: Page) => expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 })
const settle = async (page: Page) => {
  await page.mouse.move(5, 900)
  await page.waitForTimeout(500)
}

/** The story feed (narration also goes to the hidden screen-reader announcer, so match inside the feed). */
const story = (page: Page) => page.getByRole('log', { name: 'Story so far' })

async function say(page: Page, text: string) {
  const composer = page.getByLabel('What do you do?')
  await composer.fill(text)
  await composer.press('Enter')
}

test('character setup, a love interest, and a route switch that shifts the story', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))

    // A Story campaign on the Romance route, Gentle.
    await page.getByPlaceholder('Campaign name').fill('Hearts Afire')
    await page.locator('[data-route="romance"]').click()
    await page.getByRole('tab', { name: 'Gentle' }).click()
    await page.getByRole('button', { name: 'Begin the adventure' }).click()

    // Identity: name, pronouns, one answer, and the GM fleshes it out.
    const setup = page.getByTestId('character-setup')
    await setup.getByLabel('Character name').fill('Ilse')
    await setup.getByRole('button', { name: 'she/her' }).click()
    await setup.getByRole('button', { name: 'A runaway noble' }).click()
    await setup.getByRole('button', { name: 'Let the GM flesh it out' }).click()
    await expect(setup.getByLabel('Background')).toHaveValue(/A runaway noble\. The road has taught you/)
    await settle(page)
    await page.screenshot({ path: shot('character-setup.png') })

    // Companions: bring Liora as a love interest.
    await setup.getByRole('button', { name: 'Choose companions' }).click()
    await expect(setup.getByTestId('companion-option')).toHaveCount(3)
    await setup.getByRole('button', { name: 'Bring Liora' }).click()
    await setup.getByLabel('Bond with Liora').selectOption('love-interest')
    await settle(page)
    await page.screenshot({ path: shot('companions.png') })
    await setup.getByRole('button', { name: 'Begin as Ilse' }).click()
    await expect(setup).toHaveCount(0)
    await expect(page.getByTestId('route-button')).toContainText('Romance')

    // The opening follows the route; Liora answers as a sweetheart.
    await say(page, 'I step inside.')
    await expect(story(page).getByText(/familiar smile/)).toBeVisible({ timeout: 30_000 })
    await idle(page)
    await say(page, 'How do you feel about me?')
    await expect(story(page).getByText(/You really have to ask\? I like you/)).toBeVisible({ timeout: 30_000 })
    await idle(page)

    // People: Liora is a companion at the Sweetheart stage, with a romance bar.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Journal' }).click()
    await page.getByRole('tab', { name: 'People' }).click()
    const liora = page.locator('[data-testid="person-card"][data-name="Liora"]')
    await expect(liora.getByTestId('bond-stage')).toHaveText('Sweetheart')
    await expect(liora.getByTestId('companion-badge')).toBeVisible()
    await expect(liora).toContainText('Romance')
    await settle(page)
    await page.screenshot({ path: shot('people-bonds.png') })

    // Edit her after creation: a new personality sticks, and the card shows it. The hero is editable too.
    await liora.getByTestId('edit-person').click()
    const edit = page.getByRole('dialog', { name: 'Edit Liora' })
    await edit.getByLabel('Personality').fill('Quietly fierce, laughs at storms.')
    await settle(page)
    await page.screenshot({ path: shot('edit-person.png') })
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect(edit).toBeHidden()
    await expect(liora).toContainText('Quietly fierce, laughs at storms.')
    await page.getByTestId('hero-card').getByTestId('edit-person').click()
    const editHero = page.getByRole('dialog', { name: /^Edit / })
    await expect(editHero.getByLabel('Pronouns')).toBeVisible()
    await editHero.getByRole('button', { name: 'Cancel' }).click()

    // Switch to Horror; the next scene opens with dread instead.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Adventure' }).click()
    await page.getByTestId('route-button').click()
    const dialog = page.getByRole('dialog', { name: 'What kind of story?' })
    await dialog.locator('[data-route="horror"]').click()
    await settle(page)
    await page.screenshot({ path: shot('route-dialog.png') })
    await dialog.getByRole('button', { name: 'Change the story' }).click()
    await expect(page.getByTestId('route-button')).toContainText('Horror')
    await say(page, 'I step inside again.')
    await expect(story(page).getByText(/candles burn blue/)).toBeVisible({ timeout: 30_000 })
    await idle(page)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
