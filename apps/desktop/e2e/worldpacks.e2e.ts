import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'

// World packs with the demo GM: import a .dndworld file (the file dialogs are stubbed in the main process), start
// in it with its story route, play one of its preset heroes with an edited companion, export the world with the
// hero from the Journal, and remove the imported pack.

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const shot = (name: string) => join(HERE, 'results', name)

const PREMISE = 'The lighthouse keepers are vanishing one by one, and the tide remembers why.'
const PACK = {
  format: 'dnd-world-pack',
  version: 1,
  meta: { author: 'E2E', notes: 'A test pack.' },
  world: {
    id: 'glass-isles',
    name: 'Glass Isles',
    summary: 'A chain of glass islands where the sea keeps secrets.',
    premise: PREMISE,
    tone: { label: 'Eerie', notes: 'Quiet dread, salt and lamplight.' },
    currencies: [{ id: 'shell', name: 'Shell', baseValue: 1 }],
    regions: [
      { id: 'lantern-reef', name: 'Lantern Reef', summary: 'Lighthouses on every rock.' },
      { id: 'still-water', name: 'Still Water', summary: 'A sea without waves.' },
    ],
    start: { name: 'Keeper’s Rest', description: 'An inn at the foot of the tallest lighthouse.', regionId: 'lantern-reef' },
  },
  story: { route: 'mystery', custom: '', intensity: 'gentle' },
  heroes: [
    {
      id: 'kael',
      identity: { name: 'Kael', pronouns: 'he/him', background: 'A keeper’s son who saw his father walk into the sea.', appearance: 'Salt-white hair.' },
      companions: [{ name: 'Vex', role: 'Smuggler', description: 'Knows every cove.', personality: 'Sly and loyal.', bond: 'rival' }],
    },
    { id: 'senna', identity: { name: 'Senna', pronouns: 'she/her', background: 'A cartographer of drowned places.' } },
  ],
}

test('a world pack: import, play a preset hero, export with the hero, remove', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'dnd-e2e-'))
  const packFile = join(profile, 'glass-isles.dndworld')
  const exported = join(profile, 'exported.dndworld')
  writeFileSync(packFile, JSON.stringify(PACK))
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, DND_DEMO_GM: '1' } })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960))
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.open] })) as typeof dialog.showOpenDialog
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.save })) as typeof dialog.showSaveDialog
    }, { open: packFile, save: exported })
    const nav = page.getByRole('navigation', { name: 'Main' })

    // Import: the pack is listed with its heroes, picked, and its story route is preselected.
    await page.getByRole('button', { name: 'Import world…' }).click()
    const card = page.locator('[data-pack="glass-isles"]')
    await expect(card).toContainText('2 heroes')
    await expect(card).toContainText('By E2E')
    await expect(card.getByTestId('world-option')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-route="mystery"]')).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(5, 900)
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('world-pack-import.png') })

    // Play the preset hero Kael, renamed, with his companion edited.
    await page.getByPlaceholder('Campaign name').fill('Tide Lights')
    await page.getByRole('button', { name: 'Begin the adventure' }).click()
    const setup = page.getByTestId('character-setup')
    await expect(setup.getByTestId('hero-choice')).toHaveCount(3, { timeout: 15_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('hero-choice.png') })
    await setup.locator('[data-hero="kael"]').click()
    await expect(setup.getByLabel('Character name')).toHaveValue('Kael')
    await expect(setup.getByLabel('Background')).toHaveValue(/walk into the sea/)
    await setup.getByLabel('Character name').fill('Kaelen')
    await setup.getByRole('button', { name: 'Choose companions' }).click()
    await expect(setup.getByTestId('companion-option')).toHaveCount(1)
    await expect(setup.getByTestId('companion-option')).toHaveAttribute('data-picked', 'true')
    await setup.getByRole('button', { name: 'Edit Vex' }).click()
    await setup.getByLabel('Companion role').fill('Reformed smuggler')
    await page.waitForTimeout(300)
    await page.screenshot({ path: shot('companion-edit.png') })
    await setup.getByRole('button', { name: 'Done editing Vex' }).click()
    await expect(setup.getByLabel('Bond with Vex')).toHaveValue('rival')
    await setup.getByRole('button', { name: 'Begin as Kaelen' }).click()
    await expect(setup).toHaveCount(0)
    await expect(page.getByTestId('route-button')).toContainText('Mystery')

    // Export the campaign's world with the hero as a preset; the file carries the premise, hero and companion.
    await nav.getByRole('button', { name: 'Journal' }).click()
    await page.getByRole('tab', { name: 'Codex' }).click()
    await page.getByRole('switch', { name: 'Include my hero as a preset' }).click()
    await page.getByRole('button', { name: 'Export this world…' }).click()
    await expect(page.getByText(/Saved “Glass Isles”/)).toBeVisible()
    const pack = JSON.parse(readFileSync(exported, 'utf8'))
    expect(pack).toMatchObject({ format: 'dnd-world-pack', world: { name: 'Glass Isles', premise: PREMISE }, story: { route: 'mystery', intensity: 'gentle' } })
    expect(pack.heroes).toHaveLength(1)
    expect(pack.heroes[0]).toMatchObject({ identity: { name: 'Kaelen', pronouns: 'he/him' }, companions: [{ name: 'Vex', role: 'Reformed smuggler', bond: 'rival' }] })

    // Remove the imported pack from Home.
    await nav.getByRole('button', { name: 'Home' }).click()
    await card.hover()
    await card.getByRole('button', { name: 'Remove Glass Isles' }).click()
    await card.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(card).toHaveCount(0)
    await expect(page.locator('[data-testid="world-pack"][data-source="builtin"]')).toHaveCount(2)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
