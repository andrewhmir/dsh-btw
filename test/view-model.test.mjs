import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverlayView } from '../src/client/view-model.mjs';
import { OVERLAY_CSS } from '../src/client/styles.mjs';

const closed = {
  open: false, sessionId: null, question: '', status: 'idle', answer: '',
  error: null, errorCode: null, finish: null, usage: null, reasoningChars: 0, continuations: 0,
};

test('closed state renders nothing', () => {
  assert.equal(buildOverlayView(closed).visible, false);
});

test('streaming state exposes title, question, partial answer and hint', () => {
  const view = buildOverlayView({ ...closed, open: true, question: 'why?', status: 'streaming', answer: 'because' });
  assert.equal(view.visible, true);
  assert.equal(view.title, 'Side question — not saved to this conversation');
  assert.equal(view.question, 'why?');
  assert.equal(view.answer, 'because');
  assert.match(view.hint, /×/);
  assert.equal(view.statusLabel, 'Answering…');
  assert.equal(view.error, null);
  assert.equal(view.note, null);
});

test('thinking progress is visible before the first answer token', () => {
  const view = buildOverlayView({ ...closed, open: true, question: 'q', status: 'streaming', reasoningChars: 1500 });
  assert.equal(view.statusLabel, 'Thinking… 1.5k');
  const early = buildOverlayView({ ...closed, open: true, question: 'q', status: 'streaming', reasoningChars: 12 });
  assert.equal(early.statusLabel, 'Thinking… 12');
});

test('done, truncated, error and cache-read states are all representable', () => {
  const done = buildOverlayView({ ...closed, open: true, question: 'q', status: 'done', answer: 'a', finish: 'stop', usage: { cacheReadTokens: 12 } });
  assert.equal(done.statusLabel, '');
  assert.equal(done.cacheReadTokens, 12);
  assert.equal(done.note, null);

  const truncated = buildOverlayView({ ...closed, open: true, question: 'q', status: 'done', answer: 'a', finish: 'max-tokens' });
  assert.match(truncated.note, /cut off/);

  const continued = buildOverlayView({ ...closed, open: true, question: 'q', status: 'done', answer: 'a', finish: 'max-tokens', continuations: 2 });
  assert.match(continued.note, /after 2 continuations/);
  assert.equal(continued.statusLabel, 'continued ×2');

  const thinkingOnly = buildOverlayView({ ...closed, open: true, question: 'q', status: 'done', answer: '', finish: 'max-tokens', reasoningChars: 1200 });
  assert.match(thinkingOnly.note, /during thinking/);

  const failed = buildOverlayView({ ...closed, open: true, question: 'q', status: 'error', error: 'rate limited', errorCode: 'RATE_LIMIT' });
  assert.equal(failed.error, 'rate limited');
  assert.equal(failed.errorCode, 'RATE_LIMIT');
});

test('a failure keeps the partial answer and says it arrived first', () => {
  const view = buildOverlayView({
    ...closed, open: true, question: 'q', status: 'error', answer: 'half an answer',
    error: 'the model stopped sending output', errorCode: 'STALLED',
  });
  assert.equal(view.answer, 'half an answer');
  assert.equal(view.error, 'the model stopped sending output');
  assert.match(view.note, /before the stream ended/);
});

test('the stylesheet renders a non-modal card that does not cover the app', () => {
  assert.match(OVERLAY_CSS, /\.dsh-btw-dock/);
  assert.match(OVERLAY_CSS, /\.dsh-btw-card/);
  assert.match(OVERLAY_CSS, /--dsw-/);
  assert.match(OVERLAY_CSS, /pointer-events:none/);
  assert.doesNotMatch(OVERLAY_CSS, /data-shortcut-modal/);
  assert.doesNotMatch(OVERLAY_CSS, /dsh-btw-backdrop/);
  assert.doesNotMatch(OVERLAY_CSS, /inset:0/);
});
