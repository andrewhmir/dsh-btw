// The /btw panel: a dismissible, NON-MODAL floating card in the app frame.
//
// Registered as a `shell.overlay` list entry (see client-entry.js). While
// closed it renders null. While open:
//   * the card floats above the chat (bottom-right) and the rest of the app
//     stays fully interactive: no backdrop, no focus trap, no global keys;
//   * the × button closes it, and Escape closes it while the card has focus;
//   * role="region" (never dialog/aria-modal) keeps the shortcuts service from
//     treating it as the modal owner, so composer and conversation shortcuts
//     keep working while an answer streams.
//
// The root also exposes `data-btw-status` and `data-btw-cache-read-tokens` as
// verification hooks for the E2E script; they are not shown to the user.

import { OVERLAY_CSS } from './styles.mjs';
import { buildOverlayView } from './view-model.mjs';

/**
 * Build the panel component around the injected React and overlay store.
 * @param {object} input - inputs.
 * @param {object} input.React - the browser module table's React.
 * @param {object} input.store - overlay store from createOverlayStore().
 * @param {Function} [input.MarkdownText] - seeded primitives markdown renderer; plain text fallback when absent.
 * @returns {Function} a React function component.
 */
export function createOverlayComponent({ React, store, MarkdownText }) {
  const h = React.createElement;
  // React component types can be functions or forwardRef/memo objects.
  const renderMarkdown = MarkdownText !== undefined && MarkdownText !== null;

  /** @returns {object|null} the rendered panel, or null while closed. */
  function BtwOverlay() {
    const state = React.useSyncExternalStore(store.subscribe, store.getState, store.getState);
    const view = buildOverlayView(state);

    if (!view.visible) return null;

    // The answer and the failure are rendered together: a stream that dies
    // after 300 words must not make those words disappear.
    const answerBody =
      view.answer.length > 0
        ? renderMarkdown
          ? h(MarkdownText, { text: view.answer })
          : view.answer
        : view.status === 'streaming'
          ? h('span', { className: 'dsh-btw-thinking' }, view.statusLabel)
          : '';

    const attrs = {
      className: 'dsh-btw-dock',
      role: 'region',
      'aria-label': 'Side question',
      'data-btw-status': view.status,
    };
    if (view.cacheReadTokens !== null) {
      attrs['data-btw-cache-read-tokens'] = String(view.cacheReadTokens);
    }

    return h(
      'div',
      attrs,
      h('style', { 'data-dsh-btw': '' }, OVERLAY_CSS),
      h(
        'div',
        {
          className: 'dsh-btw-card',
          // Focusable so Escape works once the user clicks into the answer,
          // without stealing focus from the composer when it opens.
          tabIndex: -1,
          onKeyDown: (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault?.();
            event.stopPropagation?.();
            store.close();
          },
        },
        h(
          'div',
          { className: 'dsh-btw-title' },
          h('span', null, view.title),
          h(
            'button',
            { type: 'button', className: 'dsh-btw-close', 'aria-label': 'Close side question', onClick: () => store.close() },
            '×',
          ),
        ),
        h('div', { className: 'dsh-btw-question' }, view.question),
        h(
          'div',
          { className: renderMarkdown ? 'dsh-btw-answer dsh-btw-answer--markdown' : 'dsh-btw-answer' },
          answerBody,
        ),
        view.note === null ? null : h('div', { className: 'dsh-btw-note' }, view.note),
        view.error === null ? null : h('div', { className: 'dsh-btw-error' }, view.error),
        h(
          'div',
          { className: 'dsh-btw-footer' },
          h('span', null, view.hint),
          view.statusLabel.length === 0 ? null : h('span', { className: 'dsh-btw-status' }, view.statusLabel),
        ),
      ),
    );
  }

  return BtwOverlay;
}
