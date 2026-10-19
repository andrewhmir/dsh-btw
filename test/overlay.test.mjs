// Overlay rendering: markdown through the seeded primitives MarkdownText when
// available, plain-text fallback otherwise, and plain error text.
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
  answer: 'This is **bold** and `code`.', error: null, finish: 'stop', usage: { cacheReadTokens: 7 },
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

test('an error answer stays plain text even when MarkdownText exists', () => {
  function MarkdownText() {}
  const React = fakeReact();
  const Overlay = createOverlayComponent({
    React,
    store: storeWith({ ...done, status: 'error', error: 'rate limited', answer: '' }),
    MarkdownText,
  });
  const tree = Overlay();
  assert.equal(find(tree, (node) => node.type === MarkdownText), null);
  assert.ok(JSON.stringify(tree).includes('rate limited'));
});

test('the overlay still renders nothing while closed', () => {
  const React = fakeReact();
  const Overlay = createOverlayComponent({ React, store: storeWith({ ...done, open: false }) });
  assert.equal(Overlay(), null);
});
