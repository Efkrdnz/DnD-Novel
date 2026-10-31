import { expect, type Page } from '@playwright/test'

/** Every new campaign opens character setup: name the hero and set out alone. */
export async function finishCharacterSetup(page: Page, name: string): Promise<void> {
  const setup = page.getByTestId('character-setup')
  await expect(setup).toBeVisible({ timeout: 15_000 })
  await setup.getByLabel('Character name').fill(name)
  await setup.getByRole('button', { name: 'Choose companions' }).click()
  await expect(setup.getByTestId('companion-option')).toHaveCount(3)
  await setup.getByRole('button', { name: 'Travel alone' }).click()
  await expect(setup).toHaveCount(0)
}
