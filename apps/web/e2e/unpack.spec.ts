import { expect, test } from '@playwright/test';

type EditorHook = {
  getState: () => {
    select: (id: string) => void;
    update: (id: string, data: Record<string, unknown>) => void;
    addNode: (kind: string, opts?: { parentId?: string | null; after?: string }) => string;
    setLayout: (boxes: Record<string, { x: number; y: number }>) => void;
  };
};

const PROCEDURE = [
  '1. **Check the tests** ran on the branch.',
  '2. **Read the description** and compare it with the diff.',
  '3. **List the risks** you see.',
].join('\n');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('skillgraph:bridgeUrl'))
      localStorage.setItem('skillgraph:bridgeUrl', 'http://127.0.0.1:1');
  });
  await page.route('**/api/ai/status', (route) =>
    route.fulfill({ json: { ok: true, local: false, ai: null, claude: null } }),
  );
});

test('a markdown blob of steps is flagged and unpacks into step nodes from the inspector', async ({
  page,
}) => {
  await page.goto('/app');
  await page.getByLabel(/name/i).first().fill('unpack-skill');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/edit\//, { timeout: 60_000 });
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);

  // Put a raw markdown node holding a numbered procedure into the Understand phase.
  const rawId = await page.evaluate((body) => {
    const store = (window as unknown as { __skillgraph: EditorHook }).__skillgraph.getState();
    const id = store.addNode('raw_markdown', { parentId: 'phase_understand', after: 'ask_gaps' });
    store.update(id, { body });
    store.select(id);
    return id;
  }, PROCEDURE);
  const before = await page.locator('.react-flow__node').count();

  // The inspector (right aside) names the hidden steps, the lint flags them, and one click turns them into nodes.
  const aside = page.locator('aside').last();
  await expect(aside).toContainText('3 list item(s) are hiding inside this markdown');
  await expect(aside).toContainText('graph/procedure-in-markdown');
  await page.getByTestId('unpack-node').click();

  await expect(page.locator('.react-flow__node')).toHaveCount(before + 2);
  await expect(page.getByTestId(`rf__node-${rawId}`)).toHaveCount(0);
  const preview = page.locator('.prose-preview');
  await expect(preview).toContainText('Check the tests');
  await expect(preview).toContainText('List the risks');
  await expect(aside).not.toContainText('graph/procedure-in-markdown');

  // Undo brings the blob back.
  await page.getByTitle('Undo (⌘Z)').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before);
});

test('unpacking several blobs at once anchors each run to its own blob', async ({ page }) => {
  await page.goto('/app');
  await page.getByLabel(/name/i).first().fill('unpack-many');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/edit\//, { timeout: 60_000 });
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);

  // Two blobs in two different phases, each pinned to a position of its own.
  await page.evaluate(() => {
    const store = (window as unknown as { __skillgraph: EditorHook }).__skillgraph.getState();
    const spots: [string, string, number][] = [
      ['phase_understand', 'Alpha', 300],
      ['phase_do', 'Bravo', 520],
    ];
    for (const [parentId, lead, y] of spots) {
      const id = store.addNode('raw_markdown', { parentId });
      store.update(id, { body: `1. **${lead} one** do it.\n2. **${lead} two** then this.` });
      store.setLayout({ [id]: { x: 16, y } });
    }
  });
  const before = await page.locator('.react-flow__node').count();

  await page.getByRole('button', { name: 'Open AI chat' }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('unpack-raw')).toContainText('Unpack 2 into nodes');
  await page.getByTestId('unpack-raw').click();

  // Four steps replace two blobs, and nothing is left hiding in markdown.
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 2);
  await expect(page.getByTestId('unpack-raw')).toHaveCount(0);

  // Each run starts where its own blob sat, rather than all of them at the first blob's spot.
  const placed = await page.evaluate(() => {
    const store = (
      window as unknown as {
        __skillgraph: {
          getState: () => {
            file: {
              doc: { nodes: { id: string; title?: string }[] };
              layout: { nodes: Record<string, { x: number; y: number }> };
            };
          };
        };
      }
    ).__skillgraph.getState();
    const { doc, layout } = store.file;
    const spot = (title: string) => {
      const n = doc.nodes.find((x) => x.title === title);
      const b = n ? layout.nodes[n.id] : undefined;
      return b ? { x: b.x, y: b.y } : null;
    };
    return { alpha: spot('Alpha one'), bravo: spot('Bravo one') };
  });
  expect(placed.alpha).toEqual({ x: 16, y: 300 });
  expect(placed.bravo).toEqual({ x: 16, y: 520 });
});
