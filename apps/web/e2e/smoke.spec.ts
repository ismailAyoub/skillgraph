import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURE = resolve(__dirname, '../../../fixtures/web-design-guidelines/SKILL.md');

// A developer's own `skillgraph dev` bridge on 127.0.0.1:4321, or a logged-in `claude` next to the
// dev server, would make AI "connected" and change what the tests see. Point the app at a dead
// bridge port and answer the local status probe with "no relay" for the whole suite; a test that
// wants a particular Claude Code state registers its own route (later routes win).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('skillgraph:bridgeUrl'))
      localStorage.setItem('skillgraph:bridgeUrl', 'http://127.0.0.1:1');
  });
  await page.route('**/api/ai/status', (route) =>
    route.fulfill({ json: { ok: true, local: false, ai: null, claude: null } }),
  );
});

/** What `/api/ai/status` reports when `claude` is installed next to the server but logged out. */
const CLAUDE_LOGGED_OUT = {
  ok: true,
  local: true,
  ai: null,
  claude: {
    bin: '/usr/local/bin/claude',
    loggedIn: false,
    method: null,
    subscription: null,
    account: null,
  },
};
const CLAUDE_LOGGED_IN = {
  ok: true,
  local: true,
  ai: 'claude-cli',
  claude: {
    bin: '/usr/local/bin/claude',
    loggedIn: true,
    method: 'claude.ai',
    subscription: 'max',
    account: 'me@example.com',
  },
};

test('create a skill from a template, edit it, and see the compiled preview', async ({ page }) => {
  await page.goto('/app');
  await page.getByLabel(/name/i).first().fill('smoke-skill');
  await page.getByRole('button', { name: 'Create' }).click();
  // The first hit compiles the route on a cold dev server (slow in CI).
  await expect(page).toHaveURL(/\/edit\//, { timeout: 60_000 });
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
  // The first hit compiles the route on a cold dev server (slow in CI).
  await expect(page).toHaveURL(/\/edit\//, { timeout: 60_000 });
  await expect(page.locator('header')).toContainText('web-design-guidelines');
  await page.getByRole('button', { name: 'SKILL.md' }).click();
  await expect(page.locator('pre')).toContainText('name: web-design-guidelines');
  await expect(page.locator('pre')).toContainText('## How It Works');
});

async function newSkill(page: import('@playwright/test').Page, name: string) {
  await page.goto('/app');
  await page.getByLabel(/name/i).first().fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  // The first hit compiles the route on a cold dev server (slow in CI).
  await expect(page).toHaveURL(/\/edit\//, { timeout: 60_000 });
}

test('the AI panel says AI is not connected and offers Connect AI when nothing is set', async ({
  page,
}) => {
  await newSkill(page, 'ai-tab-skill');
  // The header "Chat" button opens the AI panel on the chat mode.
  await page.getByRole('button', { name: 'Open AI chat' }).click();
  await expect(page.getByTestId('ai-no-key')).toContainText('Connect AI');
  await expect(page.getByTestId('chat-start')).toBeDisabled();
  // Nothing else is callable either.
  await page.getByRole('button', { name: 'Critique', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review this skill' })).toBeDisabled();
  // Connect AI from the hint opens the dialog with both options explained.
  await page.getByTestId('ai-no-key').getByRole('button', { name: 'Connect AI' }).click();
  await expect(page.getByRole('dialog', { name: 'Connect AI' })).toBeVisible();
  await expect(page.getByTestId('ai-choice-bridge')).toContainText('Claude subscription');
  await expect(page.getByTestId('ai-choice-api')).toContainText('API key');
});

test('the subscription path names the next step (log in), then flips to connected', async ({
  page,
}) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: CLAUDE_LOGGED_OUT }));
  await page.goto('/app');
  // Header and chat card both say what is missing, not a generic "Connect AI".
  await expect(page.getByTestId('ai-status')).toContainText('Log in to Claude Code');
  await expect(page.getByTestId('ai-start-connect')).toContainText('Log in to Claude Code first');
  await page.getByTestId('ai-status').click();
  const dialog = page.getByRole('dialog', { name: 'Connect AI' });
  const choice = dialog.getByTestId('ai-choice-bridge');
  await expect(choice).toContainText('not logged in');
  await expect(choice.getByTestId('ai-step-relay')).toHaveAttribute('data-state', 'done');
  await expect(choice.getByTestId('ai-step-install')).toHaveAttribute('data-state', 'done');
  await expect(choice.getByTestId('ai-step-login')).toHaveAttribute('data-state', 'current');
  await expect(choice.getByTestId('ai-step-login')).toContainText('claude auth login');
  await expect(choice.getByTestId('ai-step-login')).toContainText('Paste code here');

  // The user logs in from a terminal; the next probe updates the dialog without a reload.
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: CLAUDE_LOGGED_IN }));
  await page.evaluate(() => window.dispatchEvent(new Event('skillgraph:settings')));
  await expect(choice).toContainText('connected');
  await expect(choice.getByTestId('ai-step-login')).toHaveAttribute('data-state', 'done');
  await expect(choice.getByTestId('ai-step-login')).toContainText('me@example.com');
  await expect(choice.getByTestId('ai-step-login')).toContainText('max');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('ai-status')).toContainText('AI: Claude subscription');
  await expect(page.getByTestId('ai-start-connect')).toHaveCount(0);
});

test('Connect AI dialog stores the API key in localStorage', async ({ page }) => {
  await newSkill(page, 'settings-skill');
  await expect(page.getByRole('button', { name: 'AI setup' })).toContainText('Connect AI');
  await page.getByRole('button', { name: 'AI setup' }).click();
  await page.getByTestId('ai-choice-api').getByRole('radio').check();
  await page.getByTestId('settings-api-key').fill('sk-test');
  await page.getByTestId('settings-save').click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('skillgraph:anthropicKey')))
    .toBe('sk-test');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('skillgraph:aiBackend')))
    .toBe('api');
  // The header stops nagging once a key is set.
  await expect(page.getByRole('button', { name: 'AI setup' })).not.toContainText('Connect AI');
});

test('dashboard chat drafts the skill and Create skill opens the editor on that chat', async ({
  page,
}) => {
  await page.goto('/app');
  const card = page.getByTestId('ai-start');
  await expect(card).toContainText('What should this skill do?');
  // Without AI connected the card points at Connect AI and the dialog opens from it.
  await expect(card.getByTestId('ai-start-connect')).toBeVisible();
  await card.getByTestId('ai-start-connect').click();
  await expect(page.getByRole('dialog', { name: 'Connect AI' })).toBeVisible();
  await page.keyboard.press('Escape');

  // With a key set, the first message starts the chat on the dashboard. The fake key makes the
  // call fail, which the chat shows inline; the draft exists anyway.
  await page.evaluate(() => {
    localStorage.setItem('skillgraph:anthropicKey', 'sk-test');
    localStorage.setItem('skillgraph:aiBackend', 'api');
  });
  await page.reload();
  await expect(card.getByTestId('ai-start-connect')).toHaveCount(0);
  await card.getByTestId('ai-start-text').fill('Review a pull request against our house style');
  await card.getByTestId('ai-start-go').click();
  const chat = card.getByTestId('ai-start-chat');
  await expect(chat).toContainText('Review a pull request against our house style');
  await expect(chat).toContainText(/key|invalid|error/i);
  await expect(card).toContainText('review-pull-request-house');

  // Create skill saves the draft and opens the editor with the conversation in the AI panel.
  await card.getByTestId('ai-start-create').click();
  await expect(page).toHaveURL(/\/edit\//, { timeout: 60_000 });
  await expect(page.locator('header')).toContainText('review-pull-request-house');
  await expect(page.getByRole('button', { name: 'Open AI chat' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('Review a pull request against our house style')).toBeVisible();
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
  await expect(page.getByRole('navigation', { name: 'Dashboard' })).toBeVisible();
  // With Supabase env set a Sign in button appears; without it the bar stays minimal.
  const signIn = page.getByRole('button', { name: /sign in/i });
  const enabled = (await signIn.count()) > 0;
  if (enabled) await expect(signIn).toBeVisible();

  await page.goto('/s/not-a-real-slug');
  await expect(page.getByText(/not public|Accounts are not enabled|Loading/)).toBeVisible();
  if (enabled) await expect(page.getByText('This link is not public.')).toBeVisible();
});
