// Shared fakes for the dsh-btw host route tests. No harness imports.

import { EventEmitter } from 'node:events';

/**
 * Minimal IncomingMessage stand-in: emits its body as one data chunk, then end.
 * The default body is a valid, live-session request so tests that are not about
 * validation can call `makeReq()` with no arguments.
 * @param {object} [options] - request shape.
 * @returns {EventEmitter} fake request.
 */
export function makeReq({
  method = 'POST',
  url = '/btw/ask',
  remoteAddress = '127.0.0.1',
  body = JSON.stringify({ sessionId: 'sess-1', question: 'why?' }),
} = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.socket = { remoteAddress };
  req.destroy = () => {};
  queueMicrotask(() => {
    if (body !== '') req.emit('data', Buffer.from(body, 'utf8'));
    req.emit('end');
  });
  return req;
}

/**
 * Minimal ServerResponse stand-in capturing status, headers and body.
 * @returns {object} fake response with `body()`/`json()` readers.
 */
export function makeRes() {
  return {
    status: 0,
    headers: undefined,
    chunks: [],
    ended: false,
    flushed: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk) {
      this.chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(String(chunk));
      this.ended = true;
    },
    flushHeaders() {
      this.flushed = true;
    },
    body() {
      return this.chunks.join('');
    },
    json() {
      return JSON.parse(this.body());
    },
  };
}

/**
 * Fake live Agent with a Session exposing the two APIs the plugin uses.
 * @param {object} [options] - fixture values.
 * @returns {{session: object, options: object}} fake agent.
 */
export function fakeAgent({ messages, header, options, id = 'sess-1', onAppend = () => {} } = {}) {
  const history = Object.freeze(
    messages ?? [Object.freeze({ role: 'user', content: Object.freeze([{ type: 'text', text: 'hi' }]) })],
  );
  const session = {
    id,
    requestHeader: () => header,
    deriveMessages: () => history,
    // Ephemerality invariant: the plugin must never append to a session.
    append: (...args) => {
      onAppend(...args);
      throw new Error('session.append must never be called by dsh-btw');
    },
  };
  return { session, options: options ?? {} };
}
