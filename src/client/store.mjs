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
export function createOverlayStore() {
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
