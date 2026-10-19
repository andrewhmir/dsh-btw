import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderBundle } from '../tools/build-client.mjs';

const norm = (s) => s.replace(/\r\n/g, '\n');

test('renderBundle is deterministic and matches the committed client.js', () => {
  const built = renderBundle();
  const onDisk = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.equal(norm(onDisk), norm(built));
});

test('the envelope registers id @andrewhmir/dsh-btw with a one-argument factory returning exports', () => {
  const built = renderBundle();
  assert.match(built, /window\.__ModuleLoader__\.load\(/);
  assert.match(built, /id: "@andrewhmir\/dsh-btw"/);
  assert.match(built, /factory: function \(require\)/);
  assert.match(built, /return exports;/);
  assert.ok(!/^import\s/m.test(built), 'bundled output must not contain ESM imports');
  assert.ok(!/^export\s/m.test(built), 'bundled output must not contain ESM exports');
});

test('the bundle exposes the plugin contract', () => {
  const built = renderBundle();
  assert.match(built, /exports\.name = "dsh-btw"/);
  assert.match(built, /exports\.inject = \[/);
  assert.match(built, /exports\.apply = apply/);
});
