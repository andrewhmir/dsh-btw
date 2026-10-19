import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Create a fake React whose hooks are synchronous and whose element tree is inspectable. */
function makeFakeReact() {
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      return getSnapshot();
    },
    useEffect() {},
  };
}

function loadBundle(fetchImpl, primitives = {}) {
  const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  let registration;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (config) => {
          registration = config;
        },
      },
    },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    TextDecoder,
    ReadableStream,
    Response,
    AbortController,
    fetch: fetchImpl,
  };
  vm.runInNewContext(code, sandbox);
  return registration;
}

function makeRequire(react, primitives) {
  return (id) => {
    if (id === 'react') return react;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error(`unexpected module ${id}`);
  };
}

function find(node, predicate) {
  if (node === null || node === undefined) return null;
  if (typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return null;
}

test('bundle registers a plugin that wires the slash source and the overlay seat', () => {
  const registration = loadBundle(async () => new Response(''));
  assert.equal(registration.id, '@andrewhmir/dsh-btw');
  assert.equal(registration.factory.length, 1);
  const react = makeFakeReact();
  const plugin = registration.factory(makeRequire(react, {}));
  assert.equal(plugin.name, 'dsh-btw');
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'inputTriggers']);
  assert.equal(typeof plugin.apply, 'function');
});

test('apply registers the /btw source and the shell.overlay entry, and submit POSTs once', async () => {
  const fetches = [];
  const registration = loadBundle(async (url, init) => {
    fetches.push([url, init]);
    return new Response('{"type":"delta","text":"ok"}\n{"type":"done","finish":"stop"}\n');
  });
  const react = makeFakeReact();
  const plugin = registration.factory(makeRequire(react, {}));
  let source;
  let slotEntry;
  let slotFactory;
  const slotsService = {
    inject(name, factory) {
      slotFactory = factory;
    },
    register(meta, component) {
      slotEntry = { meta, component };
      return () => {};
    },
  };
  const ctx = {
    get(service) {
      if (service === 'inputTriggers') return { registerSource: (s) => { source = s; return () => {}; } };
      if (service === 'slots') return slotsService;
      return undefined;
    },
    effect(fn) {
      return fn();
    },
  };
  plugin.apply(ctx);
  assert.equal(source.trigger, '/');
  assert.equal(source.name, 'btw');
  assert.equal(typeof slotFactory, 'function');
  slotFactory();
  assert.equal(slotEntry.meta.name, 'shell.overlay');
  assert.equal(slotEntry.meta.id, 'btw-overlay');
  assert.equal(slotEntry.meta.order, 100);

  const outcome = await source.matchEnter({ sessionId: 'sess-1' }, '/btw hello', new AbortController().signal, { attachments: 0 });
  assert.equal(outcome.claim.name, 'btw');
  // The claim object is created inside the VM realm, so compare fields rather
  // than deepStrictEqual (which also compares prototypes).
  assert.equal((await outcome.claim.submit('hello')).kind, 'success');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0][0], '/btw/ask');
  assert.deepEqual(JSON.parse(fetches[0][1].body), { sessionId: 'sess-1', question: 'hello' });

  const empty = await source.matchEnter({ sessionId: 'sess-1' }, '/btw', new AbortController().signal, { attachments: 0 });
  assert.equal((await empty.claim.submit('')).kind, 'error');
  assert.equal(fetches.length, 1);
});

test('the entry passes the seeded MarkdownText into the overlay and renders the answer through it', async () => {
  function MarkdownText() {}
  const registration = loadBundle(
    async () => new Response('{"type":"delta","text":"This is **bold**."}\n{"type":"done","finish":"stop"}\n'),
  );
  const react = makeFakeReact();
  const plugin = registration.factory(makeRequire(react, { MarkdownText }));
  let source;
  let slotEntry;
  const ctx = {
    get(service) {
      if (service === 'inputTriggers') return { registerSource: (s) => { source = s; return () => {}; } };
      if (service === 'slots') {
        return {
          inject(name, factory) {
            factory();
          },
          register(meta, component) {
            slotEntry = { meta, component };
            return () => {};
          },
        };
      }
      return undefined;
    },
    effect(fn) {
      return fn();
    },
  };
  plugin.apply(ctx);
  const outcome = await source.matchEnter({ sessionId: 'sess-1' }, '/btw hello', new AbortController().signal, { attachments: 0 });
  await outcome.claim.submit('hello');

  // Poll the rendered tree until the stream settles into the done answer.
  let markdownNode = null;
  for (let attempt = 0; attempt < 100 && markdownNode === null; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    const tree = slotEntry.component();
    markdownNode = find(tree, (node) => node.type === MarkdownText);
  }
  assert.ok(markdownNode, 'expected MarkdownText to receive the streamed answer');
  assert.equal(markdownNode.props.text, 'This is **bold**.');
});
