import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('every GitHub Action is pinned to an immutable commit', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  const uses = workflow.split(/\r?\n/).filter(line => /^\s*uses:\s+/.test(line));
  assert.ok(uses.length > 0, 'expected at least one action reference');
  for (const line of uses) {
    assert.match(line, /@[0-9a-f]{40}(?:\s+#\s+\S+)?\s*$/, `mutable action reference: ${line.trim()}`);
  }
});
