// The /btw overlay: a dismissible, centred panel over the whole app frame.
//
// Registered as a `shell.overlay` list entry (see client-entry.js). While
// closed it renders null, so the additive slot stays click-through. While open:
//   * Escape, Space, and Enter dismiss it from a capture-phase listener;
//   * a backdrop click or the close button dismisses it;
//   * `role="dialog" aria-modal="true"` + `data-shortcut-modal="btw"` tell the
//     shortcuts service this is the modal owner, so background shortcuts and
//     the conversation's double-Escape stop do not react.
//
// The root also exposes `data-btw-status` and `data-btw-cache-read-tokens` as
// verification hooks for the E2E script; they are not shown to the user.

import { OVERLAY_CSS } from './styles.mjs';
import { buildOverlayView } from './view-model.mjs';

/**
 * Build the overlay component around the injected React and overlay store.
 * @param {object} input - inputs.
 * @param {object} input.React - the browser module table's React.
 * @param {object} input.store - overlay store from createOverlayStore().
 * @param {Function} [input.MarkdownText] - seeded primitives markdown renderer; plain text fallback when absent.
 * @returns {Function} a React function component.
 */
export function createOverlayComponent({ React, store, MarkdownText }) {
  const h = React.createElement;
  const renderMarkdown = typeof MarkdownText === 'function';

  /** @returns {object|null} the rendered overlay, or null while closed. */
  function BtwOverlay() {
    const state = React.useSyncExternalStore(store.subscribe, store.getState, store.getState);
    const view = buildOverlayView(state);

    React.useEffect(() => {
      if (!view.visible) return undefined;
      const onKeyDown = (event) => {
        if (event.key === ' ' || event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          store.close();
        }
      };
      document.addEventListener('keydown', onKeyDown, true);
      return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [view.visible]);

    if (!view.visible) return null;

    const answerBody =
      view.status === 'error'
        ? h('span', { className: 'dsh-btw-error' }, view.error ?? 'The side question failed.')
        : view.answer.length > 0
          ? renderMarkdown
            ? h(MarkdownText, { text: view.answer })
            : view.answer
          : view.status === 'streaming'
            ? h('span', { className: 'dsh-btw-thinking' }, 'Thinking…')
            : '';

    const attrs = {
      className: 'dsh-btw-backdrop',
      'data-shortcut-modal': 'btw',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Side question',
      'data-btw-status': view.status,
      onMouseDown: () => store.close(),
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
        { className: 'dsh-btw-card', onMouseDown: (event) => event.stopPropagation() },
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
        view.truncationNote === null ? null : h('div', { className: 'dsh-btw-note' }, view.truncationNote),
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
