import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pkgPath = new URL('package.json', root);
const pkg = () => JSON.parse(readFileSync(pkgPath, 'utf8'));

test('manifest declares the dsh-btw bundle, client half, engine floor and MIT license', () => {
  const p = pkg();
  assert.equal(p.name, 'dsh-btw');
  assert.equal(p.version, '0.1.0');
  assert.equal(p.type, 'module');
  assert.equal(p.main, './host.js');
  assert.equal(p.license, 'MIT');
  assert.equal(p.icon, './icon.svg');
  assert.equal(p.engines.dsh, '>=0.2.1-rc.2');
  assert.equal(p.dependencies, undefined, 'zero runtime dependencies');
  assert.equal(p.peerDependencies, undefined, 'no peer deps: host imports no harness package');
  assert.equal(p.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(p.dsh.client.platform, 'web');
  assert.equal(p.dsh.client.immediately, false);
  for (const dep of ['@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-commands',
    '@deepseek-ai/dsh-client-ui-input-trigger']) {
    assert.ok(p.dsh.client.inject.includes(dep), dep);
  }
  assert.equal(p.exports['.'], './host.js');
  assert.equal(p.exports['./client'], './client.js');
  assert.equal(p.exports['./cordis.patch.yml'], './cordis.patch.yml');
  assert.equal(p.exports['./icon'], './icon.svg');
  assert.equal(p.exports['./locale/*.json'], './locale/*.json');
});

test('every exported and shipped path exists', () => {
  const p = pkg();
  const must = [p.main, p.exports['./client'], p.exports['./cordis.patch.yml'],
    p.icon, 'locale/en.json', 'locale/zh.json', 'LICENSE', 'README.md', 'MOUNT.md'];
  for (const rel of must) assert.ok(existsSync(new URL(rel, root)), rel);
});

test('patch inserts exactly one self-named row', () => {
  const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8');
  assert.match(patch, /^- insert:/m);
  assert.equal((patch.match(/- id: btw$/gm) ?? []).length, 1);
  assert.equal((patch.match(/name: dsh-btw$/gm) ?? []).length, 1);
});

test('locale metadata is complete in en and zh', () => {
  for (const lang of ['en', 'zh']) {
    const meta = JSON.parse(readFileSync(new URL(`locale/${lang}.json`, root), 'utf8')).meta;
    assert.ok(meta.title.trim().length > 0, lang);
    assert.ok(meta.description.trim().length > 0, lang);
  }
});

test('icon is a small valid SVG and LICENSE is MIT', () => {
  const icon = readFileSync(new URL('icon.svg', root), 'utf8');
  assert.match(icon, /^<svg[\s>]/);
  assert.ok(statSync(new URL('icon.svg', root)).size <= 256 * 1024);
  assert.match(readFileSync(new URL('LICENSE', root), 'utf8'), /MIT License/);
});

test('no machine-specific absolute paths or secrets in shipped code', () => {
  for (const rel of ['host.js', 'client.js', 'package.json', 'cordis.patch.yml']) {
    assert.ok(!/C:\\Users\\/i.test(readFileSync(new URL(rel, root), 'utf8')), rel);
  }
});
