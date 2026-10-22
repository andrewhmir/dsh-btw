// GENERATED FILE - do not edit by hand.
// Assembled from src/client/*.mjs by tools/build-client.mjs.
// Run `node tools/build-client.mjs` after changing a source module.

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
// Stylesheet for the /btw floating card. Rendered as a <style> React element
// inside the panel root, so unmounting the panel removes it. Every color/shadow
// comes from the harness theme tokens; no hard-coded palette.
//
// The dock is click-through (`pointer-events:none`) so only the card itself
// takes input; there is no backdrop and nothing covers the chat.

const OVERLAY_CSS = [
  '[data-btw-status].dsh-btw-dock{position:absolute;right:20px;bottom:96px;z-index:30;display:flex;justify-content:flex-end;width:min(560px,calc(100% - 32px));pointer-events:none}',
  '.dsh-btw-card{pointer-events:auto;box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-height:min(60vh,520px);padding:14px 16px;gap:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:14px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-shadow-lv2,0 16px 48px rgba(0,0,0,.25))}',
  '.dsh-btw-card:focus{outline:2px solid var(--dsw-alias-border-focus,rgba(0,120,255,.45));outline-offset:2px}',
  '.dsh-btw-title{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,#555)}',
  '.dsh-btw-close{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#555);font-size:16px;line-height:1;padding:4px 8px;border-radius:8px;cursor:pointer}',
  '.dsh-btw-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111)}',
  '.dsh-btw-question{border-left:2px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));padding-left:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#555);white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dsh-btw-answer{flex:1 1 auto;min-height:48px;overflow-y:auto;overscroll-behavior:contain;font-size:14px;line-height:22px;white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dsh-btw-answer--markdown{white-space:normal}',
  '.dsh-btw-answer--markdown>:first-child{margin-top:0}',
  '.dsh-btw-answer--markdown>:last-child{margin-bottom:0}',
  '.dsh-btw-answer--markdown pre{max-width:100%;overflow-x:auto}',
  '.dsh-btw-thinking{color:var(--dsw-alias-label-secondary,#555)}',
  '.dsh-btw-error{border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));padding-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#b3261e)}',
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
// Pure presentation model for the /btw panel, so the copy and the state
// mapping are testable without a DOM or React.

/**
 * Format a character count for the activity line ("1.5k").
 * @param {number} value - non-negative character count.
 * @returns {string} compact count.
 */
function formatCount(value) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return String(Math.floor(value));
  const scaled = value / 1000;
  return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)}k`;
}

/**
 * Explain an unusual ending without hiding the answer.
 * @param {object} run - resolved run facts.
 * @returns {string|null} note text, or null for an ordinary finish.
 */
function noteFor({ status, finish, answer, reasoningChars, continuations }) {
  if (status === 'error') {
    return answer.length > 0 ? 'The text above arrived before the stream ended.' : null;
  }
  if (finish !== 'max-tokens') return null;
  if (answer.length === 0) {
    return reasoningChars > 0
      ? 'The output limit was reached during thinking, before any answer text arrived.'
      : 'The output limit was reached before any answer text arrived.';
  }
  if (continuations > 0) {
    return `Still cut off at the length limit after ${continuations} continuation${continuations === 1 ? '' : 's'}.`;
  }
  return 'The answer was cut off at the length limit.';
}

/**
 * Map one store state to the view the component renders.
 * @param {object} state - overlay store state.
 * @returns {object} view fields.
 */
function buildOverlayView(state) {
  const status = typeof state?.status === 'string' ? state.status : 'idle';
  const answer = typeof state?.answer === 'string' ? state.answer : '';
  const finish = state?.finish ?? null;
  const usage = state?.usage ?? null;
  const reasoningChars = Number.isFinite(state?.reasoningChars) ? state.reasoningChars : 0;
  const continuations = Number.isFinite(state?.continuations) ? state.continuations : 0;
  const streaming = status === 'streaming';

  let statusLabel = '';
  if (streaming) {
    statusLabel =
      answer.length > 0
        ? 'Answering…'
        : reasoningChars > 0
          ? `Thinking… ${formatCount(reasoningChars)}`
          : 'Thinking…';
  } else if (status === 'done' && continuations > 0) {
    statusLabel = `continued ×${continuations}`;
  }

  return {
    visible: state?.open === true,
    title: 'Side question — not saved to this conversation',
    question: typeof state?.question === 'string' ? state.question : '',
    answer,
    hint: '× closes · Esc while this card is focused',
    error: typeof state?.error === 'string' ? state.error : null,
    errorCode: typeof state?.errorCode === 'string' ? state.errorCode : null,
    note: noteFor({ status, finish, answer, reasoningChars, continuations }),
    statusLabel,
    cacheReadTokens:
      usage !== null && Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : null,
    status,
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
// A failure never discards the text that already arrived: `answer` survives
// `onError`, so the panel can show the partial answer and the failure together.
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
    errorCode: null,
    finish: null,
    usage: null,
    /** Reasoning characters the provider streamed before the answer started. */
    reasoningChars: 0,
    /** Automatic continuation rounds spent on a truncated answer. */
    continuations: 0,
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
   * @returns {{signal: AbortSignal, onDelta: Function, onDone: Function, onError: Function, onProgress: Function}} run bindings.
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
      errorCode: null,
      finish: null,
      usage: null,
      reasoningChars: 0,
      continuations: 0,
    });

    return {
      signal: runController.signal,
      onDelta(text) {
        if (!live() || typeof text !== 'string' || text.length === 0) return;
        publish({ ...state, answer: state.answer + text });
      },
      onProgress(frame) {
        if (!live() || typeof frame?.reasoningChars !== 'number' || !Number.isFinite(frame.reasoningChars)) return;
        publish({ ...state, reasoningChars: frame.reasoningChars });
      },
      onDone(frame) {
        if (!live()) return;
        publish({
          ...state,
          status: 'done',
          finish: typeof frame?.finish === 'string' ? frame.finish : 'stop',
          usage: frame?.usage ?? null,
          continuations:
            typeof frame?.continuations === 'number' && Number.isInteger(frame.continuations) && frame.continuations >= 0
              ? frame.continuations
              : state.continuations,
          reasoningChars:
            typeof frame?.reasoningChars === 'number' && Number.isFinite(frame.reasoningChars)
              ? frame.reasoningChars
              : state.reasoningChars,
        });
      },
      onError(error) {
        if (!live()) return;
        publish({
          ...state,
          status: 'error',
          error:
            typeof error?.message === 'string' && error.message.length > 0
              ? error.message
              : 'The side question failed.',
          errorCode: typeof error?.code === 'string' ? error.code : 'ERROR',
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
//   {"type":"progress","reasoningChars":N}
//   {"type":"done","finish":"stop"|"max-tokens","usage":{…},"continuations":N}
//   {"type":"error","code":"…","message":"…"}
// Chunks may split a line anywhere, so the reader buffers partial lines.
//
// The reader also guarantees a settlement: a body that ends without a done or
// error frame (server died, proxy cut the socket) is reported as STREAM_ENDED
// instead of leaving the overlay on "Thinking…" forever.
//
// Pure module: no DOM, no React, no harness imports.

/**
 * Read one NDJSON response body and dispatch its frames.
 *
 * @param {ReadableStream<Uint8Array>} body - the response body stream.
 * @param {{onDelta: Function, onDone: Function, onError: Function, onProgress?: Function}} handlers - frame handlers.
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
  let settled = false;

  /** Report one failure at most once. @param {object} error - code + message. */
  const fail = (error) => {
    if (failed || settled) return;
    failed = true;
    settled = true;
    handlers.onError(error);
  };

  const dispatch = (line) => {
    if (settled || failed || line.trim() === '') return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      fail({ code: 'CORRUPT_STREAM', message: 'The side answer stream was corrupted.' });
      return;
    }
    if (frame?.type === 'delta') {
      handlers.onDelta(typeof frame.text === 'string' ? frame.text : '');
    } else if (frame?.type === 'done') {
      settled = true;
      handlers.onDone(frame);
    } else if (frame?.type === 'error') {
      fail({
        code: typeof frame.code === 'string' ? frame.code : 'ERROR',
        message: typeof frame.message === 'string' ? frame.message : 'The side question failed.',
      });
    } else if (frame?.type === 'progress' && typeof handlers.onProgress === 'function') {
      handlers.onProgress(frame);
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
    if (!settled && !failed) {
      fail({ code: 'STREAM_ENDED', message: 'The side answer stream ended before it finished.' });
    }
  } catch (error) {
    fail({
      code: typeof error?.code === 'string' ? error.code : 'STREAM_ERROR',
      message: error?.message ?? String(error),
    });
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
 * @param {{onDelta: Function, onDone: Function, onError: Function, onProgress?: Function}} input.handlers - frame handlers.
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

const styles = __dsh_btw.styles;
const { OVERLAY_CSS } = __dsh_btw.styles;
const viewModel = __dsh_btw.viewModel;
const { buildOverlayView } = __dsh_btw.viewModel;

/**
 * Build the panel component around the injected React and overlay store.
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
