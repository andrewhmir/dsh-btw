import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayStore } from '../src/client/store.mjs';

test('start opens a streaming overlay, deltas accumulate, done closes the stream state', () => {
  const store = createOverlayStore();
  const run = store.start({ sessionId: 's1', question: 'why?' });
  let state = store.getState();
  assert.equal(state.open, true);
  assert.equal(state.status, 'streaming');
  assert.equal(state.question, 'why?');
  assert.equal(state.sessionId, 's1');
  run.onDelta('Hel');
  run.onDelta('lo');
  state = store.getState();
  assert.equal(state.answer, 'Hello');
  run.onDone({ finish: 'stop', usage: { cacheReadTokens: 42 } });
  state = store.getState();
  assert.equal(state.status, 'done');
  assert.equal(state.finish, 'stop');
  assert.equal(state.usage.cacheReadTokens, 42);
  assert.equal(run.signal.aborted, false);
});

test('fail records an error and close aborts the signal and resets state', () => {
  const store = createOverlayStore();
  const run = store.start({ sessionId: 's1', question: 'q' });
  run.onError({ code: 'RATE_LIMIT', message: 'slow down' });
  assert.equal(store.getState().status, 'error');
  assert.equal(store.getState().error, 'slow down');
  store.close();
  assert.equal(run.signal.aborted, true);
  assert.deepEqual(store.getState(), {
    open: false, sessionId: null, question: '', status: 'idle',
    answer: '', error: null, finish: null, usage: null,
  });
});

test('a newer start aborts the old run and ignores its late callbacks', () => {
  const store = createOverlayStore();
  const first = store.start({ sessionId: 's1', question: 'first' });
  const second = store.start({ sessionId: 's1', question: 'second' });
  first.onDelta('late from first');
  first.onDone({ finish: 'stop', usage: null });
  assert.equal(store.getState().question, 'second');
  assert.equal(store.getState().answer, '');
  assert.equal(store.getState().status, 'streaming');
  assert.equal(first.signal.aborted, true);
  second.onDelta('second answer');
  assert.equal(store.getState().answer, 'second answer');
});

test('subscribers are notified and unsubscribe stops notifications', () => {
  const store = createOverlayStore();
  let notifications = 0;
  const off = store.subscribe(() => {
    notifications += 1;
  });
  const run = store.start({ sessionId: 's1', question: 'q' });
  run.onDelta('x');
  off();
  run.onDelta('y');
  assert.equal(notifications, 2);
});
