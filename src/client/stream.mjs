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
export async function readNdjsonStream(body, handlers) {
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
export async function askBtw({ url, sessionId, question, signal, fetchImpl, handlers }) {
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
