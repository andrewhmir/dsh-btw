import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverlayView } from '../src/client/view-model.mjs';
import { OVERLAY_CSS } from '../src/client/styles.mjs';

const closed = { open: false, sessionId: null, question: '', status: 'idle', answer: '', error: null, finish: null, usage: null };

test('closed state renders nothing', () => {
  assert.equal(buildOverlayView(closed).visible, false);
});

test('streaming state exposes title, question, partial answer and hint', () => {
  const view = buildOverlayView({ ...closed, open: true, question: 'why?', status: 'streaming', answer: 'because' });
  assert.equal(view.visible, true);
  assert.equal(view.title, 'Side question — not saved to this conversation');
  assert.equal(view.question, 'why?');
  assert.equal(view.answer, 'because');
  assert.equal(view.hint, 'Space / Enter / Esc to close');
  assert.equal(view.statusLabel, 'Answering…');
  assert.equal(view.error, null);
  assert.equal(view.truncationNote, null);
});

test('done, truncated, error and cache-read states are all representable', () => {
  const done = buildOverlayView({ ...closed, open: true, question: 'q', status: 'done', answer: 'a', finish: 'stop', usage: { cacheReadTokens: 12 } });
  assert.equal(done.statusLabel, '');
  assert.equal(done.cacheReadTokens, 12);
  const truncated = buildOverlayView({ ...closed, open: true, question: 'q', status: 'done', answer: 'a', finish: 'max-tokens' });
  assert.match(truncated.truncationNote, /cut off/);
  const failed = buildOverlayView({ ...closed, open: true, question: 'q', status: 'error', error: 'rate limited' });
  assert.equal(failed.error, 'rate limited');
});

test('the stylesheet uses theme tokens and the overlay class names', () => {
  assert.match(OVERLAY_CSS, /\.dsh-btw-card/);
  assert.match(OVERLAY_CSS, /--dsw-/);
  assert.match(OVERLAY_CSS, /data-shortcut-modal="btw"/);
});
