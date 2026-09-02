import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURE = resolve(__dirname, '../../../fixtures/web-design-guidelines/SKILL.md');

test('create a skill from a template, edit it, and see the compiled preview', async ({ page }) => {
  await page.goto('/app');
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
  await page.goto('/app');
  await page.locator('input[type=file][accept]').setInputFiles(FIXTURE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.locator('header')).toContainText('web-design-guidelines');
  await page.getByRole('button', { name: 'SKILL.md' }).click();
  await expect(page.locator('pre')).toContainText('name: web-design-guidelines');
  await expect(page.locator('pre')).toContainText('## How It Works');
});

async function newSkill(page: import('@playwright/test').Page, name: string) {
  await page.goto('/app');
  await page.getByLabel(/name/i).first().fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/edit\//);
}

test('the AI tab tells you to set an API key when none is set', async ({ page }) => {
  await newSkill(page, 'ai-tab-skill');
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByTestId('ai-no-key')).toContainText('Settings');
  // Nothing is callable without a key.
  await expect(page.getByRole('button', { name: 'Review this skill' })).toBeDisabled();
});

test('settings dialog stores the API key in localStorage', async ({ page }) => {
  await newSkill(page, 'settings-skill');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('settings-api-key').fill('sk-test');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('skillgraph:anthropicKey')))
    .toBe('sk-test');
  // The header stops nagging once a key is set.
  await expect(page.getByRole('button', { name: 'Settings' })).not.toContainText('Set API key');
});

test('landing page renders the hero and links to the editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('See the skill');
  const cta = page.getByRole('main').getByRole('link', { name: 'Open the editor' });
  await expect(cta).toHaveAttribute('href', '/app');
  await expect(page.getByRole('img', { name: /skill graph/i })).toBeVisible();
});

test('login page shows the three tabs, or the local-first note without accounts', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(page.getByTestId('login-card')).toBeVisible();
  const disabled = page.getByTestId('accounts-disabled');
  if (await disabled.isVisible()) {
    await expect(disabled).toContainText(/accounts/i);
    await expect(page.getByRole('link', { name: 'Continue without an account' })).toHaveAttribute(
      'href',
      '/app',
    );
    return;
  }
  const tabs = page.getByTestId('login-tabs');
  for (const name of ['Sign in', 'Create account', 'Email link'])
    await expect(tabs.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue without an account' })).toHaveAttribute(
    'href',
    '/app',
  );
});

test('dashboard shows the account bar and the shared-skill page handles unknown slugs', async ({
  page,
}) => {
  await page.goto('/app');
  await expect(page.getByText('Dashboard')).toBeVisible();
  // With Supabase env set a Sign in button appears; without it the bar stays minimal.
  const signIn = page.getByRole('button', { name: /sign in/i });
  const enabled = (await signIn.count()) > 0;
  if (enabled) await expect(signIn).toBeVisible();

  await page.goto('/s/not-a-real-slug');
  await expect(page.getByText(/not public|Accounts are not enabled|Loading/)).toBeVisible();
  if (enabled) await expect(page.getByText('This link is not public.')).toBeVisible();
});
