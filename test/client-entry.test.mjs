import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadBundle(fetchImpl) {
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

const fakeReact = {
  createElement() {},
  useSyncExternalStore() {},
  useEffect() {},
};

test('bundle registers a plugin that wires the slash source and the overlay seat', () => {
  const registration = loadBundle(async () => new Response(''));
  assert.equal(registration.id, 'dsh-btw');
  assert.equal(registration.factory.length, 1);
  const plugin = registration.factory(() => fakeReact);
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
  const plugin = registration.factory(() => fakeReact);
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
