import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test, type Locator } from '@playwright/test'
import { finishCharacterSetup } from './setup'

// Visual novel play with the demo GM: the tavern scene on the stage with busts, read page by page; emotion faces
// drawn from the portraits after the turn; the GM's choices; the log; your own picture; and the switch to classic.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const shot = (name: string) => join(HERE, 'results', name)
/** A scroller showing its last line. */
const atBottom = (scroller: Locator) => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 4)
const PNG =Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a5f3c9e70000000049454e44ae426082', 'hex')

test('visual novel mode: stage, pages, faces, choices, own picture and the classic switch', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const picture = join(profile, 'mira.png')
  writeFileSync(picture, PNG)
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, picture)
    const nav = page.getByRole('navigation', { name: 'Main' })

    await page.getByPlaceholder('Campaign name').fill('Paper Lanterns')
    await page.getByRole('button', { name: /^Visual novel/ }).click()
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    await finishCharacterSetup(page, 'Ilse')

    // An empty story starts on the stage with the composer.
    const stage = page.getByTestId('novel-stage')
    await expect(stage.getByText('Your story begins here. What do you do?')).toBeVisible()
    const composer = page.getByLabel('What do you do?')
    await composer.fill('I push open the tavern door and step out of the rain.')
    await composer.press('Enter')

    // The three tavern regulars stand on the stage; read the scene page by page.
    const box = page.getByTestId('novel-textbox')
    await expect(stage.getByTestId('bust')).toHaveCount(3, { timeout: 30_000 })
    await expect(box).toContainText('The Gilded Gull is loud tonight')
    const next = box.getByRole('button', { name: 'Next' })
    let lit = 0
    for (let i = 0; i < 12 && (await page.getByTestId('novel-choice').count()) === 0; i++) {
      await next.click()
      const speaking = await stage.locator('[data-speaking="true"]').count()
      expect(speaking).toBeLessThanOrEqual(1)
      lit += speaking
    }
    expect(lit).toBeGreaterThan(0)
    await expect(page.getByTestId('novel-choice')).toHaveCount(3)
    await page.mouse.move(5, 900)
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('novel-stage.png') })
    // Choices and then the composer fit: the text box and the composer stay on screen, the busts shrink instead.
    await expect(box).toBeInViewport({ ratio: 1 })
    await page.getByRole('button', { name: 'Something else…' }).click()
    await expect(page.getByRole('textbox', { name: /What do you do/ })).toBeInViewport({ ratio: 1 })
    await expect(box).toBeInViewport({ ratio: 1 })
    for (const bust of await stage.getByTestId('bust').all()) await expect(bust).toBeInViewport({ ratio: 0.9 })
    await page.screenshot({ path: shot('novel-composer.png') })

    // Faces were drawn from the portraits for the emotions spoken (the demo artist labels them).
    await nav.getByRole('button', { name: 'Journal' }).click()
    await page.getByRole('tab', { name: 'People' }).click()
    const mira = page.getByTestId('person-card').filter({ hasText: 'Mira' })
    await expect(mira.locator('[data-testid="face-slot"][data-emotion="happy"]')).toHaveAttribute('data-drawn', 'true', { timeout: 30_000 })
    await expect(mira.locator('[data-testid="face-slot"][data-emotion="tender"]')).toHaveAttribute('data-drawn', 'true', { timeout: 30_000 })
    await mira.scrollIntoViewIfNeeded()
    await page.screenshot({ path: shot('faces-panel.png') })

    // Your own picture replaces the portrait, and the faces made from the old one are cleared.
    await mira.getByRole('button', { name: 'Use my own picture…' }).click()
    await expect(page.getByText('New picture for Mira')).toBeVisible()
    await expect(mira.locator('[data-testid="face-slot"][data-emotion="happy"]')).toHaveAttribute('data-drawn', 'false')

    // A custom expression: it joins every character's faces, the GM uses it, and its face is drawn on first use.
    const expressions = page.getByTestId('expressions')
    await expressions.getByLabel('Expression name').fill('Lovestruck')
    await expressions.getByLabel('How the face looks').fill('heart-shaped pupils, dreamy smile, glowing cheeks')
    await expressions.getByRole('button', { name: 'Add' }).click()
    await expect(expressions.locator('[data-testid="expression"][data-id="lovestruck"]')).toBeVisible()
    const lovestruck = mira.locator('[data-testid="face-slot"][data-emotion="lovestruck"]')
    await expect(lovestruck).toHaveAttribute('data-drawn', 'false')
    await expressions.scrollIntoViewIfNeeded()
    await page.screenshot({ path: shot('expressions.png') })

    // Back on the stage, a choice plays the next turn; the log holds both turns.
    await nav.getByRole('button', { name: 'Adventure' }).click()
    await page.getByTestId('novel-choice').first().click()
    await expect(box.getByRole('button', { name: 'Log' })).toBeVisible()
    await expect(page.getByTestId('novel-choice')).toHaveCount(0)
    await expect(box).toContainText('The Gilded Gull is loud tonight', { timeout: 30_000 })
    await box.getByRole('button', { name: 'Log' }).click()
    const log = page.getByRole('dialog', { name: 'Story so far' })
    await expect(log.getByText('Buy Mira a drink and ask about the town')).toBeVisible()
    await expect(log.getByText('Lovestruck', { exact: true })).toBeVisible()
    await expect.poll(() => atBottom(log.getByTestId('novel-log'))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(log).toHaveCount(0)

    // The header switches to the classic feed (opened at the newest turn) and back.
    await page.getByRole('tab', { name: 'Classic' }).click()
    await expect(page.getByRole('log', { name: 'Story so far' })).toBeVisible()
    await expect.poll(() => atBottom(page.getByRole('log', { name: 'Story so far' }))).toBe(true)
    await expect(stage).toHaveCount(0)
    await page.getByRole('tab', { name: 'Visual novel' }).click()
    await expect(page.getByTestId('novel-stage')).toBeVisible()

    await nav.getByRole('button', { name: 'Journal' }).click()
    await page.getByRole('tab', { name: 'People' }).click()
    await expect(lovestruck).toHaveAttribute('data-drawn', 'true', { timeout: 30_000 })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
