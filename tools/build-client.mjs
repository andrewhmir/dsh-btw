// Assemble the browser half into one file.
//
// The harness serves a client plugin as a single pre-built classic script that
// registers itself with `window.__ModuleLoader__.load({id, factory})`; it never
// builds third-party client code. Source modules stay separate and unit
// testable; only this file knows how to flatten them.
//
//   node dsh-btw/tools/build-client.mjs          # write client.js
//   node dsh-btw/tools/build-client.mjs --check  # exit 1 when stale
//
// The transform is deliberately small and literal:
//   * `import ... from './x.mjs'` becomes `const { a, b } = __dsh_btw.x;`
//   * `export` keywords are dropped (the module IIFE is the scope)
//   * each module's declared exports are published on its namespace object
// Every client module must use relative `.mjs` imports only.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outFile = path.join(root, 'client.js');

/** The plugin id the module loader registers; must equal the package name. */
export const PLUGIN_ID = '@andrewhmir/dsh-btw';

/**
 * Modules that belong in the browser bundle, in evaluation order.
 *
 * A module must be emitted after everything it imports. The list is explicit,
 * never a glob: the host half's `src/host/*` modules import `node:` builtins
 * that do not exist in a browser.
 */
export const CLIENT_MODULES = [
  'src/client/styles.mjs',
  'src/client/view-model.mjs',
  'src/client/store.mjs',
  'src/client/stream.mjs',
  'src/client/trigger.mjs',
  'src/client/overlay.mjs',
];

/** Resolve an import specifier to the module namespace key it lives under. */
function keyFor(specifier) {
  return safeKey(path.basename(specifier).replace(/\.mjs$/, ''));
}

/**
 * Make a module basename usable as a JS identifier (`view-model` -> `viewModel`).
 * @param {string} basename - module basename without extension.
 * @returns {string} a valid identifier-ish namespace key.
 */
function safeKey(basename) {
  return basename.replace(/-+([a-zA-Z0-9])/g, (_, character) => character.toUpperCase());
}

/**
 * Rewrite one module body for inline inclusion.
 *
 * @param {string} name - module basename without extension.
 * @param {string} source - module source text.
 * @returns {string} the transformed module block.
 */
function transformModule(name, source) {
  let out = source;

  // Any relative import, from either `./` or `../`, flattened by basename.
  out = out.replace(
    /import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))\s*from\s*['"]\.{1,2}\/([\w./-]+)\.mjs['"]\s*;?/g,
    (match, defaultWithNamed, named, starAs, bareDefault, specifier) => {
      const key = keyFor(specifier);
      const lines = [`const ${key} = __dsh_btw.${key};`];
      if (named) {
        const specifiers = named
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const [original, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
            return alias && alias !== original ? `${original}: ${alias}` : original;
          });
        if (specifiers.length > 0) lines.push(`const { ${specifiers.join(', ')} } = __dsh_btw.${key};`);
      }
      const def = defaultWithNamed ?? starAs ?? bareDefault;
      if (def) lines.push(`const ${def} = __dsh_btw.${key}.default ?? __dsh_btw.${key};`);
      return lines.join('\n');
    },
  );

  // `export <decl>` loses the keyword. Declarations stay in the IIFE scope.
  out = out.replace(
    /^export\s+(async\s+function|function|class|const|let|var)\s/gm,
    (match, kind) => `${kind} `,
  );
  // Bare `export { ... }` lists: the IIFE publishes the declared names below.
  out = out.replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');

  // Any leftover import/export in the flattened body is a bundler bug and would
  // be a syntax error inside the factory. Fail loudly at build time.
  const leftover = out.match(/^\s*(?:import|export)\s/m);
  if (leftover !== null) {
    throw new Error(
      `unhandled ${leftover[0].trim()} statement survived the transform in ${name}.mjs - ` +
        `only relative .mjs named imports are supported by this flattener`,
    );
  }

  const declared = source.match(/^export\s+(?:async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm) ?? [];
  const names = declared.map((m) => m.replace(/^export\s+(?:async\s+function|function|class|const|let|var)\s+/, ''));
  const key = safeKey(name);

  return [
    `// ---- ${name}.mjs ${'-'.repeat(Math.max(0, 60 - name.length))}`,
    `__dsh_btw.${key} = (function () {`,
    out.trim(),
    '  var api = {};',
    ...names.map((n) => `  api.${n} = api.${n} ?? ${n};`),
    '  return api;',
    '})();',
  ].join('\n');
}

/**
 * Render the complete bundle text.
 * @returns {string} the generated `client.js` content.
 */
export function renderBundle() {
  const modules = [];
  const seen = new Set();
  for (const relative of CLIENT_MODULES) {
    const file = path.join(root, relative);
    const name = path.basename(file, '.mjs');
    if (seen.has(name)) throw new Error(`duplicate module name in CLIENT_MODULES: ${name}`);
    seen.add(name);
    modules.push(transformModule(name, readFileSync(file, 'utf8')));
  }
  const entry = readFileSync(path.join(root, 'src', 'client-entry.js'), 'utf8');

  return [
    '// GENERATED FILE - do not edit by hand.',
    '// Assembled from src/client/*.mjs by tools/build-client.mjs.',
    '// Run `node dsh-btw/tools/build-client.mjs` after changing a source module.',
    '',
    'window.__ModuleLoader__.load({',
    `  id: "${PLUGIN_ID}",`,
    '  // The loader calls the factory with ONE argument and takes its RETURN VALUE',
    '  // as the module exports, so the factory returns the exports object.',
    '  factory: function (require) {',
    '    "use strict";',
    '    var exports = {};',
    '    var __dsh_btw = {};',
    '',
    modules.join('\n\n'),
    '',
    entry.trim(),
    '',
    '    return exports;',
    '  },',
    '});',
    '',
  ].join('\n');
}

const norm = (s) => s.replace(/\r\n/g, '\n');

/** CLI entry. @returns {number} process exit code. */
export function main(argv = process.argv.slice(2)) {
  const built = renderBundle();
  if (argv.includes('--check')) {
    let current = null;
    try {
      current = readFileSync(outFile, 'utf8');
    } catch {
      console.error('client.js is missing - run: node dsh-btw/tools/build-client.mjs');
      return 1;
    }
    if (norm(current) !== norm(built)) {
      console.error('client.js is STALE - run: node dsh-btw/tools/build-client.mjs');
      return 1;
    }
    console.log('client.js is up to date');
    return 0;
  }
  writeFileSync(outFile, built, 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), outFile)} (${built.length} bytes)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
