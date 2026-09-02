import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURE = resolve(__dirname, '../../../fixtures/web-design-guidelines/SKILL.md');

test('create a skill from a template, edit it, and see the compiled preview', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/name/i).first().fill('smoke-skill');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
  const preview = page.locator('.prose-preview');
  await expect(preview).toContainText('How It Works');
  await expect(preview).toContainText('Understand');

  // Select a step through the store hook and edit its bold lead.
  await page.evaluate(() =>
    (
      window as unknown as { __skillgraph: { getState: () => { select: (id: string) => void } } }
    ).__skillgraph
      .getState()
      .select('step_restate'),
  );
  const input = page
    .locator('aside input')
    .filter({ hasNot: page.locator('[type=checkbox]') })
    .first();
  await expect(input).toHaveValue('Restate the request');
  await input.fill('Restate the goal');
  await expect(preview).toContainText('Restate the goal');

  // Add a step after the selection from the palette.
  const before = await page.locator('.react-flow__node').count();
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1);
  await expect(preview).toContainText('Do the thing');

  // Undo removes it again.
  await page.getByTitle('Undo (⌘Z)').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before);
});

test('import a SKILL.md and compile it back', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file][accept]').setInputFiles(FIXTURE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.locator('header')).toContainText('web-design-guidelines');
  await page.getByRole('button', { name: 'SKILL.md' }).click();
  await expect(page.locator('pre')).toContainText('name: web-design-guidelines');
  await expect(page.locator('pre')).toContainText('## How It Works');
});
