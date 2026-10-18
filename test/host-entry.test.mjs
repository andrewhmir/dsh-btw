import { test } from 'node:test';
import assert from 'node:assert/strict';
import { name, inject, apply } from '../host.js';

function fakeCtx({ missing } = {}) {
  const registrations = [];
  const effects = [];
  const server = {
    register: (route) => {
      registrations.push(route);
      return () => registrations.pop();
    },
  };
  const context = {
    get(service) {
      if (missing === service) return undefined;
      if (service === 'webServer') return server;
      if (service === 'agents') return { get: () => undefined };
      if (service === 'llm') return { stream: async function* () {} };
    },
    effect(fn, label) {
      effects.push(label);
      return fn();
    },
    logger: { info() {}, warn() {} },
  };
  return { context, registrations, effects };
}

test('exports the plugin identity and injects its services', () => {
  assert.equal(name, 'dsh-btw');
  assert.deepEqual(inject, ['webServer', 'llm', 'agents']);
});

test('apply registers the /btw prefix route on the web server', () => {
  const { context, registrations, effects } = fakeCtx();
  apply(context, {});
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].kind, 'prefix');
  assert.equal(registrations[0].path, '/btw');
  assert.equal(typeof registrations[0].handler, 'function');
  assert.deepEqual(effects, ['btw: web route']);
});

test('apply is defensive when a service is missing', () => {
  const { context, registrations } = fakeCtx({ missing: 'webServer' });
  assert.doesNotThrow(() => apply(context, {}));
  assert.equal(registrations.length, 0);
});
