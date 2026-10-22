import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayStore } from '../src/client/store.mjs';

const idle = {
  open: false, sessionId: null, question: '', status: 'idle', answer: '',
  error: null, errorCode: null, finish: null, usage: null, reasoningChars: 0, continuations: 0,
};

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

test('thinking progress is recorded until the answer starts', () => {
  const store = createOverlayStore();
  const run = store.start({ sessionId: 's1', question: 'q' });
  run.onProgress({ type: 'progress', reasoningChars: 321 });
  assert.equal(store.getState().reasoningChars, 321);
  run.onProgress({ type: 'progress', reasoningChars: 900 });
  assert.equal(store.getState().reasoningChars, 900);
  run.onDelta('answer');
  assert.equal(store.getState().answer, 'answer');
  assert.equal(store.getState().reasoningChars, 900);
});

test('a failure keeps the partial answer and the reasoning progress', () => {
  const store = createOverlayStore();
  const run = store.start({ sessionId: 's1', question: 'q' });
  run.onProgress({ reasoningChars: 120 });
  run.onDelta('half an answer');
  run.onError({ code: 'STALLED', message: 'the model stopped sending output' });
  const state = store.getState();
  assert.equal(state.status, 'error');
  assert.equal(state.errorCode, 'STALLED');
  assert.equal(state.error, 'the model stopped sending output');
  assert.equal(state.answer, 'half an answer', 'partial text must survive the failure');
  assert.equal(state.reasoningChars, 120);
});

test('done carries the continuation count and reasoning progress of a finished answer', () => {
  const store = createOverlayStore();
  const run = store.start({ sessionId: 's1', question: 'q' });
  run.onDelta('done text');
  run.onDone({ finish: 'stop', continuations: 1, reasoningChars: 44, usage: null });
  const state = store.getState();
  assert.equal(state.status, 'done');
  assert.equal(state.continuations, 1);
  assert.equal(state.reasoningChars, 44);
  assert.equal(state.errorCode, null);
});

test('fail records an error and close aborts the signal and resets state', () => {
  const store = createOverlayStore();
  const run = store.start({ sessionId: 's1', question: 'q' });
  run.onError({ code: 'RATE_LIMIT', message: 'slow down' });
  assert.equal(store.getState().status, 'error');
  assert.equal(store.getState().error, 'slow down');
  store.close();
  assert.equal(run.signal.aborted, true);
  assert.deepEqual(store.getState(), idle);
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
