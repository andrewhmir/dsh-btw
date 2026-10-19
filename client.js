// GENERATED FILE - do not edit by hand.
// Assembled from src/client/*.mjs by tools/build-client.mjs.
// Run `node dsh-btw/tools/build-client.mjs` after changing a source module.

window.__ModuleLoader__.load({
  id: "@andrewhmir/dsh-btw",
  // The loader calls the factory with ONE argument and takes its RETURN VALUE
  // as the module exports, so the factory returns the exports object.
  factory: function (require) {
    "use strict";
    var exports = {};
    var __dsh_btw = {};

// ---- styles.mjs ------------------------------------------------------
__dsh_btw.styles = (function () {
// Stylesheet for the /btw overlay. Rendered as a <style> React element inside
// the overlay root, so unmounting the overlay removes it. Every color/shadow
// comes from the harness theme tokens; no hard-coded palette.

const OVERLAY_CSS = [
  '[data-shortcut-modal="btw"].dsh-btw-backdrop{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;pointer-events:auto;background:color-mix(in srgb,var(--dsw-alias-bg-mask,rgba(8,12,10,.35)) 70%,transparent)}',
  '.dsh-btw-card{box-sizing:border-box;display:flex;flex-direction:column;width:min(640px,100%);max-height:min(70vh,560px);padding:16px 18px;gap:10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:16px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-shadow-lv2,0 16px 48px rgba(0,0,0,.25))}',
  '.dsh-btw-title{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,#555)}',
  '.dsh-btw-close{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#555);font-size:16px;line-height:1;padding:4px 8px;border-radius:8px;cursor:pointer}',
  '.dsh-btw-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111)}',
  '.dsh-btw-question{border-left:2px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));padding-left:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#555);white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dsh-btw-answer{flex:1 1 auto;min-height:60px;overflow-y:auto;overscroll-behavior:contain;font-size:14px;line-height:22px;white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dsh-btw-answer--markdown{white-space:normal}',
  '.dsh-btw-answer--markdown>:first-child{margin-top:0}',
  '.dsh-btw-answer--markdown>:last-child{margin-bottom:0}',
  '.dsh-btw-answer--markdown pre{max-width:100%;overflow-x:auto}',
  '.dsh-btw-thinking{color:var(--dsw-alias-label-secondary,#555)}',
  '.dsh-btw-error{color:var(--dsw-alias-state-error-primary,#b3261e)}',
  '.dsh-btw-note{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary,#8a5a00)}',
  '.dsh-btw-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#777)}',
  '.dsh-btw-status{font-variant-numeric:tabular-nums}',
].join('\n');
  var api = {};
  api.OVERLAY_CSS = api.OVERLAY_CSS ?? OVERLAY_CSS;
  return api;
})();

// ---- view-model.mjs --------------------------------------------------
__dsh_btw.viewModel = (function () {
// Pure presentation model for the /btw overlay, so the copy and the state
// mapping are testable without a DOM or React.

/**
 * Map one overlay-store state to the view the component renders.
 * @param {object} state - overlay store state.
 * @returns {object} view fields.
 */
function buildOverlayView(state) {
  const finish = state?.finish ?? null;
  const usage = state?.usage ?? null;
  return {
    visible: state?.open === true,
    title: 'Side question — not saved to this conversation',
    question: typeof state?.question === 'string' ? state.question : '',
    answer: typeof state?.answer === 'string' ? state.answer : '',
    hint: 'Space / Enter / Esc to close',
    error: typeof state?.error === 'string' ? state.error : null,
    truncationNote: finish === 'max-tokens' ? 'The answer was cut off at the length limit.' : null,
    statusLabel: state?.status === 'streaming' ? 'Answering…' : '',
    cacheReadTokens:
      usage !== null && Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : null,
    status: typeof state?.status === 'string' ? state.status : 'idle',
  };
}
  var api = {};
  api.buildOverlayView = api.buildOverlayView ?? buildOverlayView;
  return api;
})();

// ---- store.mjs -------------------------------------------------------
__dsh_btw.store = (function () {
// Overlay state store for the /btw side-answer panel.
//
// One run at a time. `start` aborts any previous provider request and mints a
// generation; handlers captured by an older generation are inert, so late
// chunks from an aborted request can never mutate a newer (or closed) overlay.
//
// Pure module: no DOM, no React, no harness imports.

/**
 * @returns {object} a fresh overlay store.
 */
function createOverlayStore() {
  const initialState = () => ({
    open: false,
    sessionId: null,
    question: '',
    status: 'idle',
    answer: '',
    error: null,
    finish: null,
    usage: null,
  });

  let state = initialState();
  let generation = 0;
  let controller = null;
  const listeners = new Set();

  function publish(next) {
    state = next;
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // A broken subscriber must not break the side-answer stream.
      }
    }
  }

  /** @returns {object} the current immutable-by-convention state. */
  function getState() {
    return state;
  }

  /**
   * Subscribe to state changes.
   * @param {(state: object) => void} listener - change listener.
   * @returns {() => void} unsubscribe.
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * Begin one side question, replacing and aborting any run in flight.
   * @param {{sessionId: string, question: string}} input - run identity.
   * @returns {{signal: AbortSignal, onDelta: Function, onDone: Function, onError: Function}} run bindings.
   */
  function start({ sessionId, question }) {
    if (controller !== null) controller.abort();
    const runController = new AbortController();
    controller = runController;
    const runGeneration = ++generation;
    const live = () => runGeneration === generation;

    publish({
      open: true,
      sessionId,
      question,
      status: 'streaming',
      answer: '',
      error: null,
      finish: null,
      usage: null,
    });

    return {
      signal: runController.signal,
      onDelta(text) {
        if (!live() || typeof text !== 'string' || text.length === 0) return;
        publish({ ...state, answer: state.answer + text });
      },
      onDone(frame) {
        if (!live()) return;
        publish({
          ...state,
          status: 'done',
          finish: typeof frame?.finish === 'string' ? frame.finish : 'stop',
          usage: frame?.usage ?? null,
        });
      },
      onError(error) {
        if (!live()) return;
        publish({
          ...state,
          status: 'error',
          error: typeof error?.message === 'string' && error.message.length > 0 ? error.message : 'The side question failed.',
        });
      },
    };
  }

  /** Close the overlay: abort the provider call and reset all state. */
  function close() {
    generation += 1;
    if (controller !== null) {
      controller.abort();
      controller = null;
    }
    publish(initialState());
  }

  return { getState, subscribe, start, close };
}
  var api = {};
  api.createOverlayStore = api.createOverlayStore ?? createOverlayStore;
  return api;
})();

// ---- stream.mjs ------------------------------------------------------
__dsh_btw.stream = (function () {
// NDJSON transport for the /btw side-answer stream.
//
// The host route answers POST /btw/ask with newline-delimited JSON frames:
//   {"type":"delta","text":"…"}
//   {"type":"done","finish":"stop","usage":{…}}
//   {"type":"error","code":"…","message":"…"}
// Chunks may split a line anywhere, so the reader buffers partial lines.
//
// Pure module: no DOM, no React, no harness imports.

/**
 * Read one NDJSON response body and dispatch its frames.
 *
 * @param {ReadableStream<Uint8Array>} body - the response body stream.
 * @param {{onDelta: Function, onDone: Function, onError: Function}} handlers - frame handlers.
 * @returns {Promise<void>} resolves when the stream ends or fails safely.
 */
async function readNdjsonStream(body, handlers) {
  if (body === undefined || body === null || typeof body.getReader !== 'function') {
    handlers.onError({ code: 'NO_BODY', message: 'The side answer stream was unavailable.' });
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let failed = false;

  const dispatch = (line) => {
    if (failed || line.trim() === '') return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      failed = true;
      handlers.onError({ code: 'CORRUPT_STREAM', message: 'The side answer stream was corrupted.' });
      return;
    }
    if (frame?.type === 'delta') {
      handlers.onDelta(typeof frame.text === 'string' ? frame.text : '');
    } else if (frame?.type === 'done') {
      handlers.onDone(frame);
    } else if (frame?.type === 'error') {
      handlers.onError({
        code: typeof frame.code === 'string' ? frame.code : 'ERROR',
        message: typeof frame.message === 'string' ? frame.message : 'The side question failed.',
      });
    }
    // Unknown frame types are ignored so a future host can add metadata.
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        dispatch(line);
        if (failed) {
          try {
            await reader.cancel();
          } catch {
            // The stream is already unusable; nothing to recover.
          }
          return;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() !== '') dispatch(buffer.replace(/\r$/, ''));
  } catch (error) {
    if (!failed) {
      handlers.onError({
        code: typeof error?.code === 'string' ? error.code : 'STREAM_ERROR',
        message: error?.message ?? String(error),
      });
    }
  }
}

/**
 * Ask the host for one side answer and stream it to the handlers.
 *
 * @param {object} input - request inputs.
 * @param {string} input.url - route URL (same origin).
 * @param {string} input.sessionId - session the composer was bound to.
 * @param {string} input.question - the trimmed question.
 * @param {AbortSignal} [input.signal] - dismissal/abort signal.
 * @param {Function} [input.fetchImpl] - fetch override for tests.
 * @param {{onDelta: Function, onDone: Function, onError: Function}} input.handlers - frame handlers.
 * @returns {Promise<void>} resolves when settled; never rejects for expected failures.
 */
async function askBtw({ url, sessionId, question, signal, fetchImpl, handlers }) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, question }),
      signal,
    });
    if (response === undefined || response === null) {
      handlers.onError({ code: 'NETWORK', message: 'The side question could not be sent.' });
      return;
    }
    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // A non-JSON error body still maps to a readable message below.
      }
      handlers.onError({
        code: typeof payload?.error?.code === 'string' ? payload.error.code : `HTTP_${response.status}`,
        message:
          typeof payload?.error?.message === 'string'
            ? payload.error.message
            : `The side-question request failed (HTTP ${response.status}).`,
      });
      return;
    }
    await readNdjsonStream(response.body, handlers);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    handlers.onError({
      code: typeof error?.code === 'string' ? error.code : 'NETWORK',
      message: error?.message ?? 'The side question could not be sent.',
    });
  }
}
  var api = {};
  api.readNdjsonStream = api.readNdjsonStream ?? readNdjsonStream;
  api.askBtw = api.askBtw ?? askBtw;
  return api;
})();

// ---- trigger.mjs -----------------------------------------------------
__dsh_btw.trigger = (function () {
// Client-side participation in the composer's input-trigger pipeline.
//
// DSH polls every registered '/' source's match hooks for a leading token and
// the first non-undefined answer wins. `ui-commands` only claims names present
// in the session's host catalog, so a source registered by this plugin can
// claim `/btw <question>` here — BEFORE any host command executes. That is what
// keeps the exchange out of the session log.
//
// Pure module: no DOM, no React, no harness imports.

/** Composer input hint shown once `/btw ` is claimed. */
const BTW_HINT = 'Ask a side question about this conversation — not saved.';

/** Must mirror the host route's question cap; the client bundle cannot import host modules. */
const MAX_QUESTION_CHARS = 4000;

/** Refusal text for attachment-carrying submissions. */
const ATTACHMENTS_REFUSED = 'The /btw command does not accept attachments.';

/**
 * Parse one complete composer line as the /btw command.
 *
 * Only a trimmed leading `/btw` line is a command. Text that merely contains
 * the token (`foo /btw x`), a longer name (`/btwx`), a second line, or the
 * inline trigger position all fall through to ordinary submission.
 *
 * `token` preserves the typed spelling: the harness computes claim arguments
 * with a case-sensitive `argsAfter(draft, claim.token)`, so a fixed lowercase
 * token would drop the question from `/BTW ...`.
 *
 * @param {string} line - complete composer draft.
 * @returns {{token: string, question: string} | undefined} typed token and trimmed question, or undefined when not /btw.
 */
function parseBtwLine(line) {
  if (typeof line !== 'string') return undefined;
  // A command line is one line; a pasted block keeps its newlines and submits
  // as ordinary text rather than being silently truncated into a question.
  if (line.includes('\n') || line.includes('\r')) return undefined;
  const match = /^(\/btw)(?:\s+([\s\S]*))?$/i.exec(line.trim());
  if (match === null) return undefined;
  return { token: match[1], question: (match[2] ?? '').trim() };
}

/**
 * Build the composer claim for a session.
 *
 * `submit` runs entirely on the client: it validates the question and hands it
 * to `submitQuestion`, which opens the overlay and starts the host request.
 * No host command RPC is involved.
 *
 * `attachments: true` makes the harness pass the composer's attachment blocks
 * to `submit`; the claim then refuses them. Every claim path (Space, menu pick,
 * restored chip, after a usage error) goes straight to `begin-submit`, so this
 * check is the only one that covers those paths.
 *
 * @param {object} input - claim inputs.
 * @param {string} input.sessionId - the session the composer is bound to.
 * @param {(sessionId: string, question: string) => object | Promise<object>} input.submitQuestion - side-question starter.
 * @param {string} [input.typedToken] - the spelling the user typed (defaults to `/btw`).
 * @returns {{name: string, token: string, hint: string, attachments: true, submit: (args: string, actx?: object, attachments?: unknown[]) => object | Promise<object>}} command claim.
 */
function makeBtwClaim({ sessionId, submitQuestion, typedToken = '/btw' }) {
  return {
    name: 'btw',
    token: `${typedToken} `,
    hint: BTW_HINT,
    attachments: true,
    submit(args, actx, attachments) {
      if (Array.isArray(attachments) && attachments.length > 0) {
        return { kind: 'error', text: ATTACHMENTS_REFUSED };
      }
      const question = typeof args === 'string' ? args.trim() : '';
      if (question.length === 0) return { kind: 'error', text: 'Usage: /btw <question>' };
      if (question.length > MAX_QUESTION_CHARS) {
        return { kind: 'error', text: 'That side question is too long (4000 characters max).' };
      }
      return submitQuestion(sessionId, question);
    },
  };
}

/**
 * Create the `/'` input-trigger source for /btw.
 *
 * @param {object} input - source inputs.
 * @param {(sessionId: string, question: string) => object | Promise<object>} input.submitQuestion - side-question starter.
 * @returns {object} an InputTriggerSource for the composer pipeline.
 */
function createBtwSource({ submitQuestion }) {
  const claimFor = (session, typedToken) =>
    makeBtwClaim({ sessionId: session.sessionId, submitQuestion, typedToken });

  return {
    trigger: '/',
    name: 'btw',
    order: 10,
    showGroupTitle: false,

    /**
     * One discoverable menu row; a query that cannot be a prefix keeps it out.
     * @param {object} session - client session projection.
     * @param {{query: string}} req - candidate request.
     * @returns {Promise<Array<{name: string, description: string}>>} matching rows.
     */
    async candidates(session, req) {
      const query = typeof req?.query === 'string' ? req.query.trim().toLowerCase() : '';
      if (query.length > 0 && !'btw'.includes(query)) return [];
      return [{ name: 'btw', description: 'Ask a side question about this conversation; the answer is not saved.' }];
    },

    /**
     * A menu pick begins command mode with our claim.
     * @param {object} pick - trigger pick.
     * @returns {{claim: object} | undefined} claim outcome.
     */
    onPick(pick) {
      if (pick?.candidate?.name !== 'btw') return undefined;
      return { claim: claimFor(pick.session) };
    },

    /**
     * Space after the bare `/btw` token claims it (composer chip).
     * @param {object} session - client session projection.
     * @param {string} token - the completed leading token, typed spelling.
     * @returns {{claim: object} | undefined} claim outcome.
     */
    matchSpace(session, token) {
      if (typeof token !== 'string' || token.toLowerCase() !== '/btw') return undefined;
      return { claim: claimFor(session, token) };
    },

    /**
     * Restore a persisted draft chip without acting.
     * @param {object} session - client session projection.
     * @param {string} token - chip token, typed spelling.
     * @returns {Promise<object | undefined>} the claim, never a submission.
     */
    async matchClaim(session, token) {
      if (typeof token !== 'string' || token.toLowerCase() !== '/btw') return undefined;
      return claimFor(session, token);
    },

    /**
     * Enter on a full line: claim `/btw <question>` in one gesture; leave every
     * other line to the other sources.
     * @param {object} session - client session projection.
     * @param {string} line - the full trimmed draft.
     * @param {AbortSignal} signal - submission cancellation.
     * @param {{attachments: number}} envelope - composer attachment count.
     * @returns {Promise<{claim: object} | undefined>} claim outcome.
     */
    async matchEnter(session, line, signal, envelope) {
      const parsed = parseBtwLine(line);
      if (parsed === undefined) return undefined;
      if ((envelope?.attachments ?? 0) > 0) {
        throw new Error(ATTACHMENTS_REFUSED);
      }
      return { claim: claimFor(session, parsed.token) };
    },
  };
}
  var api = {};
  api.BTW_HINT = api.BTW_HINT ?? BTW_HINT;
  api.parseBtwLine = api.parseBtwLine ?? parseBtwLine;
  api.makeBtwClaim = api.makeBtwClaim ?? makeBtwClaim;
  api.createBtwSource = api.createBtwSource ?? createBtwSource;
  return api;
})();

// ---- overlay.mjs -----------------------------------------------------
__dsh_btw.overlay = (function () {
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

const styles = __dsh_btw.styles;
const { OVERLAY_CSS } = __dsh_btw.styles;
const viewModel = __dsh_btw.viewModel;
const { buildOverlayView } = __dsh_btw.viewModel;

/**
 * Build the overlay component around the injected React and overlay store.
 * @param {object} input - inputs.
 * @param {object} input.React - the browser module table's React.
 * @param {object} input.store - overlay store from createOverlayStore().
 * @param {Function} [input.MarkdownText] - seeded primitives markdown renderer; plain text fallback when absent.
 * @returns {Function} a React function component.
 */
function createOverlayComponent({ React, store, MarkdownText }) {
  const h = React.createElement;
  // React component types can be functions or forwardRef/memo objects.
  const renderMarkdown = MarkdownText !== undefined && MarkdownText !== null;

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
  var api = {};
  api.createOverlayComponent = api.createOverlayComponent ?? createOverlayComponent;
  return api;
})();

// dsh-btw client entry (concatenated verbatim into the generated client.js).
//
// Two registrations on the browser plugin context:
//   1. a '/' input-trigger source that claims `/btw <question>` before any host
//      command runs — the strict-ephemerality seam;
//   2. a `shell.overlay` list entry that renders the side answer.
//
// `submitQuestion` is the only bridge between them: it opens the overlay store,
// starts the one host request without awaiting it, and lets the composer treat
// the invocation as successful (the draft clears, the overlay owns the stream).

var React = require('react');
var primitives = null;
var primitivesError = null;
try {
  primitives = require('@deepseek-ai/dsh-client-ui-primitives');
} catch (error) {
  // The primitives package is seeded by the shipped shell; an older shell that
  // lacks it degrades to the plain-text answer path.
  primitives = null;
  primitivesError = String((error && error.message) || error);
}
// MarkdownText may be a plain function component or a forwardRef/memo object,
// so presence (not `typeof === 'function'`) is the availability test.
var MarkdownText = primitives !== null && primitives.MarkdownText !== undefined && primitives.MarkdownText !== null ? primitives.MarkdownText : undefined;
try {
  window.__DSH_BTW_DIAG__ = {
    primitives: primitives !== null,
    primitiveKeys: primitives === null ? [] : Object.keys(primitives).filter(function (key) { return key === 'MarkdownText'; }),
    markdownText: typeof MarkdownText,
    primitivesError: primitivesError,
  };
} catch (error) {
  // Diagnostics must never break the plugin.
}
var trigger = __dsh_btw.trigger;
var storeModule = __dsh_btw.store;
var stream = __dsh_btw.stream;
var overlay = __dsh_btw.overlay;

function apply(ctx) {
  var store = storeModule.createOverlayStore();

  var source = trigger.createBtwSource({
    submitQuestion: function (sessionId, question) {
      var run = store.start({ sessionId: sessionId, question: question });
      void stream.askBtw({
        url: '/btw/ask',
        sessionId: sessionId,
        question: question,
        signal: run.signal,
        handlers: { onDelta: run.onDelta, onDone: run.onDone, onError: run.onError },
      });
      return { kind: 'success' };
    },
  });

  var inputTriggers = ctx.get('inputTriggers');
  if (inputTriggers !== undefined) {
    ctx.effect(function () {
      return inputTriggers.registerSource(source);
    }, 'btw: slash source');
  }

  var slots = ctx.get('slots');
  if (slots !== undefined) {
    slots.inject('shell.overlay', function () {
      return slots.register(
        { name: 'shell.overlay', id: 'btw-overlay', order: 100 },
        overlay.createOverlayComponent({ React: React, store: store, MarkdownText: MarkdownText }),
      );
    });
  }
}

exports.name = "dsh-btw";
exports.inject = ["slots", "inputTriggers"];
exports.apply = apply;

    return exports;
  },
});
