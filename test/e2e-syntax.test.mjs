import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The e2e scripts are not imported by any unit test, so a syntax error there is
// invisible to the suite until someone runs one by hand. That is exactly how a
// nested template literal in cdp-e2e.mjs shipped for a whole task. Parse every
// script here so the suite cannot go green over a broken E2E file.
const e2eDir = new URL('./e2e/', import.meta.url);
const scripts = readdirSync(e2eDir).filter((name) => name.endsWith('.mjs'));

test('every e2e script parses', () => {
  assert.ok(scripts.length >= 3, `expected the e2e scripts, found ${scripts.length}`);
  for (const name of scripts) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(name, e2eDir))], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${name} does not parse:\n${result.stderr ?? ''}`);
  }
});
