// Overlay rendering: a non-modal floating card (not a full-screen dialog),
// markdown through the seeded primitives MarkdownText when available, plain
// text fallback otherwise, and an error line that never hides partial text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayComponent } from '../src/client/overlay.mjs';

function fakeReact() {
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

function storeWith(state) {
  let current = state;
  return {
    getState: () => current,
    subscribe() {
      return () => {};
    },
    close() {
      current = { ...current, open: false };
    },
  };
}

const done = {
  open: true, sessionId: 's', question: 'why?', status: 'done',
  answer: 'This is **bold** and `code`.', error: null, errorCode: null,
  finish: 'stop', usage: { cacheReadTokens: 7 }, reasoningChars: 0, continuations: 0,
};

function find(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return null;
}

test('the answer renders in a non-modal dock, not a full-screen dialog', () => {
  const React = fakeReact();
  const Overlay = createOverlayComponent({ React, store: storeWith(done) });
  const tree = Overlay();
  assert.equal(tree.props.className, 'dsh-btw-dock');
  assert.equal(tree.props.role, 'region');
  assert.equal(tree.props['data-shortcut-modal'], undefined);
  assert.equal(tree.props['aria-modal'], undefined);
  assert.equal(find(tree, (node) => node.props?.className === 'dsh-btw-backdrop'), null);
});

test('a finished answer renders through MarkdownText when the primitive is available', () => {
  function MarkdownText() {}
  const React = fakeReact();
  const Overlay = createOverlayComponent({ React, store: storeWith(done), MarkdownText });
  const tree = Overlay();
  const markdownNode = find(tree, (node) => node.type === MarkdownText);
  assert.ok(markdownNode, 'expected a MarkdownText element');
  assert.equal(markdownNode.props.text, done.answer);
});

test('without the primitive the answer falls back to plain text', () => {
  const React = fakeReact();
  const Overlay = createOverlayComponent({ React, store: storeWith(done) });
  const tree = Overlay();
  assert.equal(find(tree, (node) => typeof node.type === 'function'), null);
  const answerNode = find(tree, (node) => node.props && node.props.className === 'dsh-btw-answer');
  assert.ok(answerNode, 'expected the answer container');
  assert.ok(JSON.stringify(tree).includes('This is **bold**'), 'plain text answer is rendered');
});

test('an error with no answer stays plain text even when MarkdownText exists', () => {
  function MarkdownText() {}
  const React = fakeReact();
  const Overlay = createOverlayComponent({
    React,
    store: storeWith({ ...done, status: 'error', error: 'rate limited', errorCode: 'RATE_LIMIT', answer: '' }),
    MarkdownText,
  });
  const tree = Overlay();
  assert.equal(find(tree, (node) => node.type === MarkdownText), null);
  assert.ok(JSON.stringify(tree).includes('rate limited'));
});

test('an error after partial streaming shows the text and the failure together', () => {
  function MarkdownText() {}
  const React = fakeReact();
  const Overlay = createOverlayComponent({
    React,
    store: storeWith({
      ...done, status: 'error', finish: null, answer: 'half an answer',
      error: 'the model stopped sending output', errorCode: 'STALLED',
    }),
    MarkdownText,
  });
  const tree = Overlay();
  const rendered = JSON.stringify(tree);
  assert.ok(rendered.includes('half an answer'), 'the partial answer stays rendered');
  assert.ok(rendered.includes('the model stopped sending output'), 'the failure is reported too');
  const errorNode = find(tree, (node) => node.props?.className === 'dsh-btw-error');
  assert.ok(errorNode);
});

test('a truncated answer says so in a note', () => {
  const React = fakeReact();
  const Overlay = createOverlayComponent({ React, store: storeWith({ ...done, finish: 'max-tokens', answer: 'cut off mid' }) });
  const tree = Overlay();
  const note = find(tree, (node) => node.props?.className === 'dsh-btw-note');
  assert.ok(note);
  assert.match(JSON.stringify(note), /cut off/);
});

test('Escape closes only from within the card, never globally', () => {
  const React = fakeReact();
  const store = storeWith(done);
  const Overlay = createOverlayComponent({ React, store });
  const tree = Overlay();
  const card = find(tree, (node) => node.props?.className === 'dsh-btw-card');
  assert.ok(card, 'expected the card');
  assert.equal(typeof card.props.onKeyDown, 'function');
  card.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(store.getState().open, false);
});

test('the overlay still renders nothing while closed', () => {
  const React = fakeReact();
  const Overlay = createOverlayComponent({ React, store: storeWith({ ...done, open: false }) });
  assert.equal(Overlay(), null);
});
